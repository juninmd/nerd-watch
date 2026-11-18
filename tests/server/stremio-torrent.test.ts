import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { config } from '../../src/server/config/config.ts';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';
import { setTorrentClientForTests, stopTorrents } from '../../src/server/torrent/engine.ts';

/**
 * Stream de addon em torrent, ponta a ponta no servidor: o addon é falso (sem rede) e o WebTorrent
 * também (sem peer, sem disco). O que se prova é a fronteira: o infohash/trackers vêm do addon e não
 * do cliente, o `fileIdx` do addon escolhe o arquivo e os erros saem como 400/501/422.
 */

const HASH = 'd4'.repeat(20);
const MANIFEST_URL = 'https://addon.example.com/manifest.json';
const BASE = 'https://addon.example.com';
const STREAM_URL = `${BASE}/stream/series/tt1%3A1%3A1.json`;

const manifest = {
  id: 'org.example.brazil',
  name: 'Addon P2P de teste',
  version: '0.0.1',
  types: ['series'],
  resources: [{ name: 'stream', types: ['series'], idPrefixes: ['tt'] }],
  catalogs: [],
  behaviorHints: { p2p: true },
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type FileSpec = { path: string; length: number };
const specs = new Map<string, FileSpec[]>();
const added: string[] = [];

const fakeFile = ({ path, length }: FileSpec) => ({
  name: path.split('/').pop() ?? path,
  path,
  length,
  progress: 0,
  async *[Symbol.asyncIterator]() {
    yield new Uint8Array(0);
  },
});

class FakeTorrent extends EventEmitter {
  destroyed = false;
  numPeers = 0;
  downloaded = 0;
  downloadSpeed = 0;
  infoHash = '';
  name = '';
  length = 0;
  files: ReturnType<typeof fakeFile>[] = [];
  destroy(): void {
    this.destroyed = true;
  }
}

class FakeClient extends EventEmitter {
  add(torrentId: string | Uint8Array): FakeTorrent {
    added.push(String(torrentId));
    const torrent = new FakeTorrent();
    setTimeout(() => {
      const infoHash = /xt=urn:btih:([0-9a-f]{40})/.exec(String(torrentId))?.[1] ?? '';
      const files = specs.get(infoHash) ?? [];
      torrent.infoHash = infoHash;
      torrent.name = 'Filme 1080p';
      torrent.files = files.map(fakeFile);
      torrent.length = files.reduce((total, file) => total + file.length, 0);
      torrent.emit('ready');
    }, 0);
    return torrent;
  }
  destroy(): void {}
}

const originalEnabled = config.torrent.enabled;
const setTorrentEnabled = (value: boolean) => {
  (config.torrent as { enabled: boolean }).enabled = value;
};

const serveStreams = (streams: unknown[]) => {
  setAddonFetch(async (url) => {
    if (url === MANIFEST_URL) return json(manifest);
    if (url === STREAM_URL) return json({ streams });
    return json({}, 404);
  });
};

const install = async (): Promise<string> => {
  const res = await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url: MANIFEST_URL }), headers: { 'content-type': 'application/json' } });
  return (await res.json()).id as string;
};

const open = (addonId: string, index: number, fileIndex?: number) =>
  stremioRoutes.request(`/addons/${addonId}/streams/series/${encodeURIComponent('tt1:1:1')}/${index}/open${fileIndex === undefined ? '' : `?fileIndex=${fileIndex}`}`, {
    method: 'POST',
  });

const torrentStream = {
  name: 'Brazuca',
  title: 'Filme 1080p Dublado',
  infoHash: HASH,
  fileIdx: 1,
  sources: ['tracker:udp://tracker.example.org:1337/announce', 'dht:xyz'],
  behaviorHints: { filename: 'Filme.1080p.mp4' },
};

beforeAll(() => {
  setTorrentClientForTests(() => new FakeClient());
});

afterAll(() => {
  setTorrentClientForTests(null);
  stopTorrents();
});

beforeEach(() => {
  stopTorrents();
  added.length = 0;
  specs.clear();
  // Um arquivo não-vídeo no índice 0: o `fileIdx` do addon aponta para o 1, e trocar de arquivo é o caso do 400.
  specs.set(HASH, [
    { path: 'capa.jpg', length: 4_000 },
    { path: 'Filme.1080p.mp4', length: 12_000_000 },
  ]);
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  setTorrentEnabled(originalEnabled);
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
  setTorrentEnabled(originalEnabled);
});

describe('streams de torrent do addon', () => {
  test('expõe infohash e nome do arquivo, sem os trackers', async () => {
    serveStreams([torrentStream]);
    const addonId = await install();
    const res = await stremioRoutes.request(`/addons/${addonId}/streams/series/${encodeURIComponent('tt1:1:1')}`);
    const text = await res.text();
    expect(text).not.toContain('tracker.example.org');
    expect(JSON.parse(text).streams).toEqual([
      { kind: 'torrent', title: 'Brazuca · Filme 1080p Dublado', url: null, infoHash: HASH, fileIdx: 1, filename: 'Filme.1080p.mp4' },
    ]);
  });

  test('infohash inválido não vira stream de torrent', async () => {
    serveStreams([{ title: 'quebrado', infoHash: 'abc' }, { title: 'sem hash', url: 'https://cdn.example.com/v.mp4' }]);
    const addonId = await install();
    const { streams } = await (await stremioRoutes.request(`/addons/${addonId}/streams/series/${encodeURIComponent('tt1:1:1')}`)).json();
    expect(streams.map((s: { kind: string }) => s.kind)).toEqual(['url']);
  });
});

describe('POST .../streams/:type/:id/:index/open', () => {
  test('abre o torrent no engine e usa o fileIdx do addon', async () => {
    serveStreams([torrentStream]);
    const addonId = await install();
    const res = await open(addonId, 0);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ infoHash: HASH, selected: { index: 1, name: 'Filme.1080p.mp4' } });
    expect(body.streamUrl).toBe(`/api/torrent/${HASH}/stream/1`);
    // O engine só recebeu o magnet normalizado: infohash + tracker, sem o `dht:` do addon.
    expect(added[0]).toContain(`magnet:?xt=urn:btih:${HASH}`);
    expect(added[0]).toContain('tr=udp%3A%2F%2Ftracker.example.org%3A1337%2Fannounce');
    expect(added[0]).not.toContain('dht');
  });

  test('troca de arquivo reusa o torrent aberto e recusa índice que não é vídeo', async () => {
    serveStreams([torrentStream]);
    const addonId = await install();
    expect((await open(addonId, 0)).status).toBe(200);
    expect((await open(addonId, 0, 1)).status).toBe(200);
    expect(added).toHaveLength(1);
    const bad = await open(addonId, 0, 0);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('não é um vídeo tocável');
  });

  test('índice fora da lista, stream que não é torrent e índice inválido são 400', async () => {
    serveStreams([torrentStream, { title: 'direto', url: 'https://cdn.example.com/v.mp4' }]);
    const addonId = await install();
    expect((await open(addonId, 9)).status).toBe(400);
    expect((await open(addonId, 1)).status).toBe(400);
    expect((await open(addonId, 0, 999)).status).toBe(400);
    expect((await stremioRoutes.request(`/addons/${addonId}/streams/series/x/abc/open`, { method: 'POST' })).status).toBe(400);
  });

  test('P2P desligado é 501 e não chega ao engine', async () => {
    serveStreams([torrentStream]);
    const addonId = await install();
    setTorrentEnabled(false);
    expect((await open(addonId, 0)).status).toBe(501);
    expect(added).toHaveLength(0);
  });

  test('addon fora do ar na hora de abrir é 502', async () => {
    serveStreams([torrentStream]);
    const addonId = await install();
    setAddonFetch(async () => json({}, 500));
    expect((await open(addonId, 0)).status).toBe(502);
  });
});
