/**
 * PoC de ponta a ponta do streaming por torrent, contra um servidor já rodando.
 *
 *   bun run dev            # numa aba
 *   bun run poc:torrent [identifier]
 *
 * Prova, pela API HTTP real: abertura do torrent, escolha do arquivo, streaming com `Range`
 * (206 + Content-Range + bytes de verdade), seek, e a fronteira de segurança do identifier.
 * Vários passos aqui existem para pegar bugs específicos que já apareceram neste código.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.POC_BASE ?? 'http://127.0.0.1:7799';
const identifier = process.argv[2] ?? 'Sita_Sings_the_Blues';
const DOWNLOAD_PATH = process.env.TORRENT_PATH ?? '.cache/torrents';

/** O servidor devolve `streamUrl` relativo (é o que o browser precisa); aqui absolutizamos. */
const abs = (path: string): string => (path.startsWith('http') ? path : `${BASE}${path}`);

const MB = 1024 * 1024;
let failures = 0;

const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const post = (path: string, body: unknown): Promise<Response> =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const dirSize = (dir: string): number => {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
};

const t0 = Date.now();
console.log(`\n1) abrindo o torrent de "${identifier}" (metadata + peers)...`);
const openRes = await post('/api/torrent/open', { identifier });
const opened = (await openRes.json()) as {
  infoHash?: string;
  error?: string;
  selected?: { index: number; name: string; label: string; length: number };
  videoFiles?: Array<{ name: string; label: string; length: number }>;
  streamUrl?: string;
};

check('POST /api/torrent/open respondeu 200', openRes.status === 200, `status ${openRes.status} ${opened.error ?? ''}`);
if (!opened.infoHash || !opened.selected || !opened.streamUrl) {
  console.error('\nfalhou antes de ter o que transmitir — abortando.');
  process.exit(1);
}
console.log(`     metadata em ${((Date.now() - t0) / 1000).toFixed(1)}s | infoHash ${opened.infoHash.slice(0, 16)}…`);
console.log(`     escolhido: ${opened.selected.name} (${opened.selected.label}, ${(opened.selected.length / MB).toFixed(1)} MB)`);
console.log(`     derivados tocáveis oferecidos: ${opened.videoFiles?.length ?? 0}`);
for (const f of opened.videoFiles ?? []) console.log(`       - ${f.label.padEnd(24)} ${(f.length / MB).toFixed(1)} MB`);

check('escolheu um MP4/WebM', /\.(mp4|webm|m4v)$/i.test(opened.selected.name));
check(
  'não escolheu o maior arquivo do torrent',
  opened.selected.length < Math.max(...(opened.videoFiles ?? []).map((f) => f.length)),
);

console.log('\n2) status do torrent (peers/velocidade)...');
let status = { numPeers: 0, progress: 0, downloadSpeed: 0 };
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  status = (await (await fetch(`${BASE}/api/torrent/${opened.infoHash}`)).json()) as typeof status;
  process.stdout.write(`\r     ${status.numPeers} peers | ${(status.downloadSpeed / 1024).toFixed(0)} KB/s | ${(status.progress * 100).toFixed(2)}% do arquivo   `);
  if (status.numPeers > 0 && status.progress > 0) break;
}
console.log();
check('o status reporta o torrent aberto', typeof status.progress === 'number');
check('o torrent grava em TORRENT_PATH, não na pasta temporária do sistema', dirSize(DOWNLOAD_PATH) > 0, `${(dirSize(DOWNLOAD_PATH) / MB).toFixed(1)} MB em ${DOWNLOAD_PATH}`);

console.log('\n3) streaming com Range (é o que o seek do player usa)...');
const ranged = await fetch(abs(opened.streamUrl), { headers: { Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(120_000) });
const body = new Uint8Array(await ranged.arrayBuffer());
check('respondeu 206 Partial Content', ranged.status === 206, `status ${ranged.status}`);
check('Content-Range correto', ranged.headers.get('content-range') === `bytes 0-262143/${opened.selected.length}`, ranged.headers.get('content-range') ?? '(vazio)');
check('Content-Type de vídeo', (ranged.headers.get('content-type') ?? '').startsWith('video/'), ranged.headers.get('content-type') ?? '(vazio)');
check('Accept-Ranges: bytes', ranged.headers.get('accept-ranges') === 'bytes');
check('o corpo tem exatamente o tamanho prometido', body.length === 262144, `${body.length} bytes`);
check('bytes não são todos zero', body.some((b) => b !== 0));

console.log('\n4) probes de Range que já quebraram este código antes...');
const oneByte = await fetch(abs(opened.streamUrl), { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(120_000) });
const oneByteBody = new Uint8Array(await oneByte.arrayBuffer());
check('bytes=0-0 devolve 206', oneByte.status === 206, `status ${oneByte.status}`);
check(
  'bytes=0-0 devolve exatamente 1 byte (o webtorrent trataria `end` 0 como "até o fim")',
  oneByteBody.length === 1 && oneByte.headers.get('content-length') === '1',
  `${oneByteBody.length} bytes, content-length ${oneByte.headers.get('content-length')}`,
);

const inverted = await fetch(abs(opened.streamUrl), { headers: { Range: 'bytes=100-50' }, signal: AbortSignal.timeout(60_000) });
check('range invertido (100-50) devolve 416', inverted.status === 416, `status ${inverted.status}`);
check('416 traz Content-Range com o tamanho total', inverted.headers.get('content-range') === `bytes */${opened.selected.length}`, inverted.headers.get('content-range') ?? '(vazio)');

const suffix = await fetch(abs(opened.streamUrl), { headers: { Range: 'bytes=-1024' }, signal: AbortSignal.timeout(120_000) });
const suffixBody = new Uint8Array(await suffix.arrayBuffer());
check('range de sufixo (últimos 1024 bytes) devolve 206', suffix.status === 206, `status ${suffix.status}`);
check('sufixo trouxe 1024 bytes', suffixBody.length === 1024, `${suffixBody.length} bytes`);
check(
  'sufixo aponta para o fim do arquivo',
  suffix.headers.get('content-range') === `bytes ${opened.selected.length - 1024}-${opened.selected.length - 1}/${opened.selected.length}`,
  suffix.headers.get('content-range') ?? '(vazio)',
);

const beyond = await fetch(abs(opened.streamUrl), { headers: { Range: `bytes=${opened.selected.length}-` }, signal: AbortSignal.timeout(60_000) });
check('range começando no fim do arquivo devolve 416', beyond.status === 416, `status ${beyond.status}`);

console.log('\n5) seek no meio do arquivo (simula arrastar a barra)...');
const mid = Math.floor(opened.selected.length / 2);
const seeked = await fetch(abs(opened.streamUrl), { headers: { Range: `bytes=${mid}-${mid + 65535}` }, signal: AbortSignal.timeout(120_000) });
const seekBody = new Uint8Array(await seeked.arrayBuffer());
check('seek respondeu 206', seeked.status === 206, `status ${seeked.status}`);
check('seek veio com bytes', seekBody.length > 0, `${seekBody.length} bytes`);

console.log('\n6) fronteira de segurança (o app não pode virar player de magnet arbitrário)...');
const badIds: Array<string | number | string[] | boolean> = [
  '../../etc/passwd',
  'https://exemplo.com/x.torrent',
  'a/b',
  'magnet:?xt=urn:btih:abc',
  123,
  ['a'],
  true,
];
for (const bad of badIds) {
  const res = await post('/api/torrent/open', { identifier: bad });
  check(`recusa identifier ${JSON.stringify(bad)}`, res.status === 400, `status ${res.status}`);
}

console.log('\n7) encerrando o torrent e conferindo a limpeza...');
const sizeBefore = dirSize(DOWNLOAD_PATH);
const closed = await fetch(`${BASE}/api/torrent/${opened.infoHash}`, { method: 'DELETE' });
check('DELETE fechou o torrent', closed.status === 200, `status ${closed.status}`);
const after = await fetch(`${BASE}/api/torrent/${opened.infoHash}`);
check('status depois de fechar dá 404', after.status === 404, `status ${after.status}`);

await new Promise((r) => setTimeout(r, 6000));
const sizeAfter = dirSize(DOWNLOAD_PATH);
check('o disco foi liberado ao fechar (destroyStoreOnDestroy)', sizeAfter < sizeBefore, `${(sizeBefore / MB).toFixed(1)} MB -> ${(sizeAfter / MB).toFixed(1)} MB`);

console.log(`\n${failures === 0 ? '✅ PoC passou' : `❌ PoC falhou (${failures} checagens)`}`);
process.exit(failures === 0 ? 0 : 1);
