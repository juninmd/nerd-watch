/**
 * PoC de ponta a ponta do streaming por torrent, contra um servidor já rodando.
 *
 *   bun run dev            # numa aba
 *   bun run scripts/poc-torrent.ts [identifier]
 *
 * Prova, pela API HTTP real: abertura do torrent, escolha do arquivo, streaming com `Range`
 * (206 + Content-Range + bytes de verdade) e a fronteira de segurança do identifier.
 */
export {};

const BASE = process.env.POC_BASE ?? 'http://127.0.0.1:7799';
const identifier = process.argv[2] ?? 'Sita_Sings_the_Blues';

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

console.log('\n3) streaming com Range (é o que o seek do player usa)...');
const ranged = await fetch(abs(opened.streamUrl), { headers: { Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(120_000) });
const body = new Uint8Array(await ranged.arrayBuffer());
check('respondeu 206 Partial Content', ranged.status === 206, `status ${ranged.status}`);
check('Content-Range correto', ranged.headers.get('content-range') === `bytes 0-262143/${opened.selected.length}`, ranged.headers.get('content-range') ?? '(vazio)');
check('Content-Type de vídeo', (ranged.headers.get('content-type') ?? '').startsWith('video/'), ranged.headers.get('content-type') ?? '(vazio)');
check('Accept-Ranges: bytes', ranged.headers.get('accept-ranges') === 'bytes');
check('veio 1 byte ou mais de conteúdo real', body.length > 0, `${body.length} bytes`);
check('bytes não são todos zero', body.some((b) => b !== 0));

console.log('\n4) seek no meio do arquivo (simula arrastar a barra)...');
const mid = Math.floor(opened.selected.length / 2);
const seeked = await fetch(abs(opened.streamUrl), { headers: { Range: `bytes=${mid}-${mid + 65535}` }, signal: AbortSignal.timeout(120_000) });
const seekBody = new Uint8Array(await seeked.arrayBuffer());
check('seek respondeu 206', seeked.status === 206, `status ${seeked.status}`);
check('seek veio com bytes', seekBody.length > 0, `${seekBody.length} bytes`);

console.log('\n5) fronteira de segurança (o app não pode virar player de magnet arbitrário)...');
const badIds = ['../../etc/passwd', 'https://exemplo.com/x.torrent', 'a/b', 'magnet:?xt=urn:btih:abc'];
for (const bad of badIds) {
  const res = await post('/api/torrent/open', { identifier: bad });
  check(`recusa identifier ${JSON.stringify(bad)}`, res.status === 400, `status ${res.status}`);
}

console.log('\n6) encerrando o torrent...');
const closed = await fetch(`${BASE}/api/torrent/${opened.infoHash}`, { method: 'DELETE' });
check('DELETE fechou o torrent', closed.status === 200, `status ${closed.status}`);
const after = await fetch(`${BASE}/api/torrent/${opened.infoHash}`);
check('status depois de fechar dá 404', after.status === 404, `status ${after.status}`);

console.log(`\n${failures === 0 ? '✅ PoC passou' : `❌ PoC falhou (${failures} checagens)`}`);
process.exit(failures === 0 ? 0 : 1);
