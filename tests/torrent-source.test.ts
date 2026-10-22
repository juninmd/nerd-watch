import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { EventEmitter } from 'node:events';
import parseTorrent from 'parse-torrent';
import { config } from '../src/server/config.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { registerTorrent, torrentSource } from '../src/server/providers/torrent/source.ts';
import { restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';
import { getTorrentSource } from '../src/server/repo/torrent-sources.ts';
import { getTelegramChannelByHandle, listTelegramItems } from '../src/server/repo/telegram.ts';
import { setTorrentClientForTests, stopTorrents } from '../src/server/torrent/engine.ts';
import { buildMagnet, parseMagnet } from '../src/server/torrent/magnet.ts';
import { makeTorrent } from './helpers/torrent-bytes.ts';

/**
 * Provider `torrent` com um WebTorrent falso injetado: nenhum peer, nenhum disco. O que se prova é
 * a costura com o engine e o banco: o que chega ao engine é o magnet normalizado, a reabertura após
 * restart usa a origem guardada, caminho hostil nunca vira escrita, e o Range é servido como vídeo.
 */

const H1 = 'a1'.repeat(20);
const H2 = 'b2'.repeat(20);
const MAGNET_H1 = `magnet:?xt=urn:btih:${H1}&dn=Colecao&x.pe=10.0.0.9:6881&tr=udp%3A%2F%2Ftracker.example.org%3A6969`;

type FileSpec = { path: string; content: Uint8Array };
interface Spec {
  name: string;
  files: FileSpec[];
}

const specs = new Map<string, Spec>();
/** O que o engine recebeu em cada `add`: um magnet (string) ou o buffer do `.torrent` normalizado. */
const added: Array<string | Uint8Array> = [];
/** Opções do `add`: `addUID` decide em que pasta os arquivos do torrent ficam. */
const addOptions: Array<{ addUID?: boolean; path?: string }> = [];
const opened: FakeTorrent[] = [];

const bytesOf = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => i % 251);

const fakeFile = ({ path, content }: FileSpec) => ({
  name: path.split('/').pop() ?? path,
  path,
  length: content.length,
  progress: 0,
  async *[Symbol.asyncIterator]({ start = 0, end = content.length - 1 }: { start?: number; end?: number } = {}) {
    yield content.subarray(start, end + 1);
  },
});

class FakeTorrent extends EventEmitter {
  destroyed = false;
  numPeers = 0;
  downloaded = 0;
  downloadSpeed = 0;
  uploaded = 0;
  uploadSpeed = 0;
  announce: string[] = [];
  urlList: string[] = [];
  infoHash = '';
  name = '';
  length = 0;
  files: ReturnType<typeof fakeFile>[] = [];

  /** A metadata só existe depois que o "peer" a entrega (ou que o .torrent já a continha). */
  adopt(infoHash: string, spec: Spec): void {
    this.infoHash = infoHash;
    this.name = spec.name;
    this.files = spec.files.map(fakeFile);
    this.length = this.files.reduce((n, f) => n + f.length, 0);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeClient extends EventEmitter {
  add(torrentId: string | Uint8Array, opts: { addUID?: boolean; path?: string } = {}): FakeTorrent {
    added.push(torrentId);
    addOptions.push(opts);
    const torrent = new FakeTorrent();
    opened.push(torrent);
    // Como no webtorrent: a metadata chega depois que o chamador já está ouvindo. Com buffer, o infohash sai do arquivo.
    setTimeout(async () => {
      const infoHash =
        typeof torrentId === 'string' ? (/xt=urn:btih:([0-9a-f]{40})/.exec(torrentId)?.[1] ?? '') : (await parseTorrent(torrentId)).infoHash;
      torrent.adopt(infoHash, specs.get(infoHash) ?? { name: 'desconhecido', files: [] });
      torrent.emit('ready');
    }, 0);
    return torrent;
  }

  destroy(): void {}
}

const CONTENT = bytesOf(10_000);
const seriesSpec = (): Spec => ({
  name: 'Colecao',
  files: [
    { path: 'Serie/Ep 10.mp4', content: CONTENT },
    { path: 'Serie/Ep 2.mkv', content: CONTENT },
    { path: 'Serie/Ep 1.mp4', content: CONTENT },
    { path: 'Serie/Sample/amostra.mp4', content: CONTENT },
    { path: 'Serie/Ep 1.nfo', content: CONTENT },
    { path: 'Serie/capa.jpg', content: CONTENT },
  ],
});

const snapshot = snapshotRegistry();
const originalFetch = globalThis.fetch;
const originalEnabled = config.torrent.enabled;

beforeAll(() => {
  setTorrentClientForTests(() => new FakeClient());
  registerTorrent();
});

afterAll(() => {
  setTorrentClientForTests(null);
  restoreRegistry(snapshot);
  stopTorrents();
});

let db: Database;

beforeEach(() => {
  stopTorrents();
  specs.clear();
  added.length = 0;
  addOptions.length = 0;
  opened.length = 0;
  specs.set(H1, seriesSpec());
  db = openDb(':memory:');
  resetDbForTests(db);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (config.torrent as { enabled: boolean }).enabled = originalEnabled;
});

const importH1 = async (): Promise<{ handle: string; name: string }> => torrentSource.resolve(MAGNET_H1);

const rejectionOf = async (promise: Promise<unknown>): Promise<SourceError> => {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SourceError);
  return err as SourceError;
};

describe('resolve — o engine recebe só o magnet normalizado', () => {
  test('abre, grava a origem canônica e devolve handle e nome do torrent', async () => {
    const res = await importH1();
    expect(res).toEqual({ handle: `torrent:${H1}`, name: 'Colecao' });

    const stored = getTorrentSource(db, H1);
    expect(stored?.magnet).toBe(buildMagnet(parseMagnet(MAGNET_H1)));
    // `x.pe` (IP de peer informado pelo link) não pode chegar ao engine nem ao banco.
    expect(added[0]).toBe(stored?.magnet);
    expect(added[0]).not.toContain('10.0.0.9');
  });

  test('cada torrent grava na própria pasta (addUID): destruir um nunca apaga arquivo de mesmo nome de outro ou do usuário', async () => {
    await importH1();
    expect(addOptions[0]?.addUID).toBe(true);
  });

  test('entrada que não é magnet nem https vira 400 e não abre nada', async () => {
    const err = await rejectionOf(torrentSource.resolve('Sita Sings the Blues'));
    expect(err.status).toBe(400);
    expect(added).toHaveLength(0);
  });

  test('URL https: o engine recebe o .torrent normalizado (trackers seguros, sem web seed), nunca a URL', async () => {
    const original = makeTorrent({
      name: 'colecao',
      files: ['Serie/Ep 1.mp4'],
      announce: ['udp://tracker.example.org:6969', 'http://10.0.0.5/announce'],
      urlList: ['https://archive.org/download/colecao/'],
    });
    const infoHash = (await parseTorrent(original)).infoHash;
    specs.set(infoHash, { name: 'colecao', files: [{ path: 'colecao/Serie/Ep 1.mp4', content: CONTENT }] });
    globalThis.fetch = (async () => new Response(new Blob([new Uint8Array(original)]), { status: 200 })) as unknown as typeof fetch;

    const res = await torrentSource.resolve('https://archive.org/download/colecao/colecao_archive.torrent');
    expect(res.handle).toBe(`torrent:${infoHash}`);

    const engineInput = added[0];
    expect(engineInput).toBeInstanceOf(Uint8Array);
    const seen = await parseTorrent(engineInput as Uint8Array);
    expect(seen.infoHash).toBe(infoHash);
    expect(seen.announce).toEqual(['udp://tracker.example.org:6969']);
    expect(seen.urlList).toEqual([]);
    // Tracker privado e a própria URL não chegam ao engine nem ao que fica guardado.
    expect(added.some((x) => typeof x === 'string' && x.includes('10.0.0.5'))).toBe(false);
    expect(getTorrentSource(db, infoHash)?.magnet).not.toContain('10.0.0.5');
  });

  test('.torrent por http é recusado antes de qualquer requisição', async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('x');
    }) as unknown as typeof fetch;
    const err = await rejectionOf(torrentSource.resolve('http://archive.org/filme.torrent'));
    expect(err.status).toBe(400);
    expect(fetched).toBe(false);
  });

  test('caminho hostil dentro do torrent recusa tudo: o torrent é destruído e nada é gravado', async () => {
    specs.set(H2, { name: 'hostil', files: [{ path: '../../etc/cron.d/evil.mp4', content: CONTENT }] });
    const err = await rejectionOf(torrentSource.resolve(`magnet:?xt=urn:btih:${H2}`));
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/caminho de arquivo inseguro/);
    expect(opened[0]?.destroyed).toBe(true);
    expect(getTorrentSource(db, H2)).toBeNull();
  });

  test('torrent desligado (TORRENT_ENABLED=false) vira 501 sem tocar em nada', async () => {
    (config.torrent as { enabled: boolean }).enabled = false;
    const err = await rejectionOf(importH1());
    expect(err.status).toBe(501);
    expect(added).toHaveLength(0);
  });
});

describe('list — vídeos em ordem natural, sem amostras, com origem estável', () => {
  test('ids crescentes na ordem natural, fileRef é o índice original e postedAt é a importação', async () => {
    await importH1();
    const items = await torrentSource.list(`torrent:${H1}`);
    const stored = getTorrentSource(db, H1);

    expect(items.map((i) => i.caption)).toEqual(['Ep 1', 'Ep 2', 'Ep 10']);
    expect(items.map((i) => i.messageId)).toEqual(['1', '2', '3']);
    // Índices originais no .torrent: Ep 1.mp4 é o 2, Ep 2.mkv é o 1, Ep 10.mp4 é o 0.
    expect(items.map((i) => i.fileRef)).toEqual(['2', '1', '0']);
    expect(new Set(items.map((i) => i.postedAt))).toEqual(new Set([stored?.addedAt]));
  });

  test('handle que não é torrent: vira 400', async () => {
    const err = await rejectionOf(torrentSource.list('torrent:nao-hash'));
    expect(err.status).toBe(400);
  });

  test('canal sem origem guardada vira 404 com instrução', async () => {
    const err = await rejectionOf(torrentSource.list(`torrent:${H2}`));
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/adicione o canal de novo/);
  });

  test('origem guardada com infohash trocado é recusada (não reabre o torrent errado)', async () => {
    db.query('INSERT INTO torrent_sources (infohash, magnet, added_at) VALUES (?, ?, ?)').run(H2, MAGNET_H1, '2026-01-01T00:00:00.000Z');
    const err = await rejectionOf(torrentSource.list(`torrent:${H2}`));
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/inconsistente/);
    expect(added).toHaveLength(0);
  });
});

describe('play — streaming com Range e reabertura após restart', () => {
  const playOf = async (fileRef: string, range?: string): Promise<Response> =>
    torrentSource.play({ handle: `torrent:${H1}`, fileRef, range });

  test('Range vira 206 com Content-Range e os bytes pedidos', async () => {
    await importH1();
    const res = await playOf('1', 'bytes=0-3');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-3/${CONTENT.length}`);
    expect(res.headers.get('Content-Type')).toBe('video/x-matroska');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 1, 2, 3]);
  });

  test('sem Range devolve o arquivo inteiro com 200 e Accept-Ranges', async () => {
    await importH1();
    const res = await playOf('0');
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect((await res.arrayBuffer()).byteLength).toBe(CONTENT.length);
  });

  test('range fora do arquivo vira 416', async () => {
    await importH1();
    const res = await playOf('0', 'bytes=999999-');
    expect(res.status).toBe(416);
  });

  test('depois de um restart (engine vazio) reabre a partir de torrent_sources e serve 206', async () => {
    await importH1();
    const magnetSaved = getTorrentSource(db, H1)?.magnet;

    // Simula o restart: o engine esquece tudo; só o banco continua.
    stopTorrents();
    added.length = 0;

    const res = await playOf('0', 'bytes=0-1023');
    expect(res.status).toBe(206);
    expect(added).toEqual([magnetSaved as string]);
    expect((await res.arrayBuffer()).byteLength).toBe(1024);
  });

  test('fileRef que não é um índice inteiro é recusado com erro de domínio 404', async () => {
    await importH1();
    const err = await rejectionOf(playOf('abc'));
    expect(err.status).toBe(404);
  });

  test('índice que aponta para não-vídeo ou para fora do torrent vira 404 da resposta, sem stream', async () => {
    await importH1();
    expect((await playOf('4')).status).toBe(404); // Ep 1.nfo
    expect((await playOf('5')).status).toBe(404); // capa.jpg
    expect((await playOf('99')).status).toBe(404);
  });

  test('handle que não é torrent válido vira erro de domínio, não 500', async () => {
    const err = await rejectionOf(torrentSource.play({ handle: 'torrent:../../x', fileRef: '0', range: undefined }));
    expect(err.status).toBe(400);
  });
});

describe('rota de conexão — POST /api/sources/torrent/channels', () => {
  test('um magnet cria o canal e já importa os vídeos (201)', async () => {
    const res = await sourcesRoutes.request('/torrent/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: MAGNET_H1 }),
    });
    expect(res.status).toBe(201);

    const channel = getTelegramChannelByHandle(db, `torrent:${H1}`);
    expect(channel?.mode).toBe('torrent');
    expect(listTelegramItems(db, channel?.id ?? '').map((i) => i.caption)).toEqual(['Ep 1', 'Ep 2', 'Ep 10']);
  });

  test('URL http é recusada pela rota com mensagem e nenhum canal é criado', async () => {
    const res = await sourcesRoutes.request('/torrent/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'http://archive.org/x.torrent' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/https/);
    expect(getTelegramChannelByHandle(db, `torrent:${H2}`)).toBeNull();
  });
});
