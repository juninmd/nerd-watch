import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { type PlexItem, toItems } from '../src/server/providers/plex/api.ts';
import { plexSource, registerPlex } from '../src/server/providers/plex/source.ts';
import { THUMB_MAX_BYTES, setMediaFetchForTests } from '../src/server/providers/sources/media-server.ts';
import { restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import type { SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';

/** Fixture só de teste: token óbvio e IDs inventados. Formato de resposta segue a API JSON do Plex (ver docs). */
const TOKEN = 'fake-token';
const BASE = 'http://192.168.0.10:32400';
const PART = '/library/parts/46618/1389985872/file.mkv';

const snapshot = snapshotRegistry();
const calls: Array<{ url: URL; init: RequestInit }> = [];
let handler: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json({ MediaContainer: {} });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const headerOf = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);
const meta = (items: PlexItem[], totalSize = items.length) => json({ MediaContainer: { size: items.length, totalSize, Metadata: items } });

/** Função, não Response: um corpo de Response só pode ser lido uma vez, e cada chamada precisa do seu. */
const sections = () =>
  json({
    MediaContainer: {
      Directory: [
        { key: '1', title: 'Filmes', type: 'movie' },
        { key: '2', title: 'Séries', type: 'show' },
        { key: '3', title: 'Música', type: 'artist' },
      ],
    },
  });
const episode: PlexItem = {
  ratingKey: '501',
  type: 'episode',
  title: 'O Início',
  grandparentTitle: 'Bleach',
  parentIndex: 1,
  index: 9,
  duration: 1_500_000,
  addedAt: 1_760_875_200,
  thumb: '/library/metadata/501/thumb/1700000000',
  Media: [{ Part: [{ key: PART }] }],
};
const movie: PlexItem = { ratingKey: '77', type: 'movie', title: 'Filme X', addedAt: 1_756_684_800 };

beforeAll(() => registerPlex());
afterAll(() => restoreRegistry(snapshot));

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  calls.length = 0;
  handler = () => json({ MediaContainer: {} });
  process.env.PLEX_URL = BASE;
  process.env.PLEX_TOKEN = TOKEN;
  setMediaFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  });
});

afterEach(() => {
  setMediaFetchForTests();
  delete process.env.PLEX_URL;
  delete process.env.PLEX_TOKEN;
});

const post = (path: string, body: unknown) => sourcesRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('biblioteca e série (add.input)', () => {
  test('seção pelo nome (sem diferença de caixa) ou pelo número', async () => {
    handler = () => sections();
    expect(await plexSource.resolve('filmes')).toEqual({ handle: 'plex:section:1', name: 'Filmes' });
    expect(await plexSource.resolve('2')).toEqual({ handle: 'plex:section:2', name: 'Séries' });
  });

  test('seção de música é recusada: só filmes e séries', async () => {
    handler = () => sections();
    const err = await plexSource.resolve('Música').catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(400);
  });

  test('show:<ID> só aceita um item do tipo série', async () => {
    handler = () => meta([{ ratingKey: '123', type: 'show', title: 'Bleach' }]);
    expect(await plexSource.resolve('show:123')).toEqual({ handle: 'plex:show:123', name: 'Bleach' });
    handler = () => meta([movie]);
    const err = await plexSource.resolve('show:77').catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(400);
  });

  test.each(['../../library/sections', 'Filmes;DROP', '%2e%2e/1', 'show:../1', 'show:1;2'])('entrada hostil %s nunca vira caminho nem chamada de metadados', async (input) => {
    handler = () => sections();
    await plexSource.resolve(input).catch(() => undefined);
    for (const call of calls) expect(call.url.pathname).toBe('/library/sections');
  });
});

describe('listagem', () => {
  test('seção de filmes: type=1, do mais novo ao mais antigo', async () => {
    handler = (url) => (url.pathname === '/library/sections' ? sections() : meta([movie]));
    await plexSource.list('plex:section:1');
    const sectionCall = calls.find((c) => c.url.pathname === '/library/sections/1/all');
    expect(sectionCall?.url.searchParams.get('type')).toBe('1');
    expect(sectionCall?.url.searchParams.get('sort')).toBe('addedAt:desc');
  });

  test('seção de séries lista episódios (type=4), não séries', async () => {
    handler = (url) => (url.pathname === '/library/sections' ? sections() : meta([episode]));
    await plexSource.list('plex:section:2');
    expect(calls.find((c) => c.url.pathname === '/library/sections/2/all')?.url.searchParams.get('type')).toBe('4');
  });

  test('série: episódios por allLeaves', async () => {
    handler = () => meta([episode]);
    await plexSource.list('plex:show:123');
    expect(calls[0]?.url.pathname).toBe('/library/metadata/123/allLeaves');
  });

  test('pagina com X-Plex-Container-Start/Size: 450 itens em três chamadas', async () => {
    handler = (url, init) => {
      if (url.pathname === '/library/sections') return sections();
      const start = Number(headerOf(init, 'X-Plex-Container-Start'));
      const size = Number(headerOf(init, 'X-Plex-Container-Size'));
      const page = Array.from({ length: Math.min(size, 450 - start) }, (_, i) => ({ ratingKey: String(1000 + start + i), type: 'movie', title: `F${start + i}`, addedAt: 1_700_000_000 + start + i }) as PlexItem);
      return meta(page, 450);
    };
    const items = await plexSource.list('plex:section:1');
    expect(items).toHaveLength(450);
    const paged = calls.filter((c) => c.url.pathname === '/library/sections/1/all').map((c) => [headerOf(c.init, 'X-Plex-Container-Start'), headerOf(c.init, 'X-Plex-Container-Size')]);
    expect(paged).toEqual([
      ['0', '200'],
      ['200', '200'],
      ['400', '100'],
    ]);
  });

  test('catálogo enorme para no teto de 500 itens', async () => {
    handler = (url, init) => {
      if (url.pathname === '/library/sections') return sections();
      const start = Number(headerOf(init, 'X-Plex-Container-Start'));
      const size = Number(headerOf(init, 'X-Plex-Container-Size'));
      return meta(Array.from({ length: size }, (_, i) => ({ ratingKey: String(start + i + 1), type: 'movie', title: `F${i}` }) as PlexItem), 99_999);
    };
    expect(await plexSource.list('plex:section:1')).toHaveLength(500);
  });

  test('episódio vira "Série SxxEyy — Nome" e filme só o nome; duração em ms vira segundos', () => {
    const [ep, mv] = toItems([episode, movie]);
    expect(ep).toMatchObject({ caption: 'Bleach S01E09 — O Início', durationSeconds: 1500, fileRef: '501' });
    expect(mv).toMatchObject({ caption: 'Filme X', durationSeconds: null, fileRef: '77' });
  });

  test('itens adicionados no mesmo segundo não colidem no messageId (senão o upsert sobrescreve um deles)', () => {
    const same = Array.from({ length: 200 }, (_, i) => ({ ...movie, ratingKey: String(i + 1) }));
    const ids = toItems(same).map((i) => i.messageId);
    expect(new Set(ids).size).toBe(200);
  });

  test('addedAt em segundos vira postedAt ISO e o messageId cresce com a data', () => {
    const [older, newer] = toItems([movie, episode]);
    expect(newer?.postedAt).toBe(new Date(1_760_875_200 * 1000).toISOString());
    expect(Number(newer?.messageId)).toBeGreaterThan(Number(older?.messageId));
  });

  test('ratingKey malformado é descartado; miniatura fora do padrão vira null', () => {
    const items = toItems([
      { ...movie, ratingKey: '../1' },
      { ...movie, ratingKey: '12;3' },
      { ...episode, thumb: '//evil.example/library/metadata/501/thumb/1' },
      { ...episode, thumb: 'http://evil.example/x.jpg' },
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.thumbnailUrl)).toEqual([null, null]);
  });

  test('canal inválido no banco é 404 sem chamada', async () => {
    for (const bad of ['plex:section:../1', 'plex:show:x', 'jellyfin:1', '']) {
      const err = await plexSource.list(bad).catch((e: unknown) => e);
      expect((err as SourceError).status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  test('criar canal pela rota grava o canal e importa os filmes', async () => {
    handler = (url) => (url.pathname === '/library/sections' ? sections() : meta([movie]));
    const res = await post('/plex/channels', { input: 'Filmes' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ mode: 'plex', title: 'Filmes', itemCount: 1, link: null });
  });
});

describe('reprodução', () => {
  const metadata = (media: unknown) => json({ MediaContainer: { Metadata: [{ ratingKey: '501', type: 'episode', Media: media }] } });

  test('resolve a parte do arquivo e repassa o Range do navegador ao arquivo original', async () => {
    handler = (url) => (url.pathname === '/library/metadata/501' ? metadata([{ Part: [{ key: PART }] }]) : new Response('abcd', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/10', 'Set-Cookie': 'x=1' } }));
    const res = await plexSource.play({ handle: 'plex:section:2', fileRef: '501', range: 'bytes=0-3' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-3/10');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const partCall = calls.find((c) => c.url.pathname === PART);
    expect(partCall).toBeDefined();
    expect(headerOf(partCall?.init ?? {}, 'X-Plex-Token')).toBe(TOKEN);
    expect(headerOf(partCall?.init ?? {}, 'Range')).toBe('bytes=0-3');
    expect(partCall?.url.origin).toBe(new URL(BASE).origin);
    expect(calls.some((c) => c.url.toString().includes(TOKEN))).toBe(false);
  });

  test.each([
    ['//evil.example/library/parts/1/2/x.mkv', 'host relativo ao protocolo'],
    ['http://evil.example/library/parts/1/2/x.mkv', 'URL absoluta'],
    ['/library/metadata/501', 'outro caminho da API'],
    ['/library/parts/1/2/../../../../etc', 'escape por ..'],
  ])('caminho de parte %s (%s) é recusado antes de qualquer requisição de arquivo', async (key) => {
    handler = () => metadata([{ Part: [{ key }] }]);
    const res = await plexSource.play({ handle: 'plex:section:2', fileRef: '501', range: undefined }).catch((e: unknown) => e);
    expect((res as SourceError).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  test('item sem arquivo é 404 com mensagem nossa', async () => {
    handler = () => metadata(undefined);
    const err = await plexSource.play({ handle: 'plex:section:2', fileRef: '501', range: undefined }).catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(404);
    expect((err as SourceError).message).toBe('vídeo sem arquivo no Plex');
  });

  test('ratingKey malformado no play é 404 e não gera requisição', async () => {
    for (const bad of ['../1', '1;2', '']) {
      const err = await plexSource.play({ handle: 'plex:section:2', fileRef: bad, range: undefined }).catch((e: unknown) => e);
      expect((err as SourceError).status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  test('redirect no arquivo não é seguido: 502 em uma chamada', async () => {
    handler = (url) => (url.pathname === '/library/metadata/501' ? metadata([{ Part: [{ key: PART }] }]) : new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }));
    const res = await plexSource.play({ handle: 'plex:section:2', fileRef: '501', range: undefined });
    expect(res.status).toBe(502);
    expect(calls.find((c) => c.url.pathname === PART)?.init.redirect).toBe('manual');
    expect(await res.text()).not.toContain('evil.example');
  });
});

describe('miniatura', () => {
  const base = { handle: 'plex:section:2', fileRef: '501' };

  test('baixa a miniatura do item pelo caminho validado, com o token no cabeçalho', async () => {
    handler = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    const bytes = await plexSource.thumb?.({ ...base, thumbnailUrl: '/library/metadata/501/thumb/1700000000' });
    expect(Array.from(bytes ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(calls[0]?.url.pathname).toBe('/library/metadata/501/thumb/1700000000');
    expect(headerOf(calls[0]?.init ?? {}, 'X-Plex-Token')).toBe(TOKEN);
  });

  test('caminho de miniatura que aponta para outro host nunca é requisitado', async () => {
    for (const thumbnailUrl of ['//evil.example/library/metadata/1/thumb/1', 'http://evil.example/x.jpg', '/library/metadata/1/thumb/1/../../x']) {
      expect(await plexSource.thumb?.({ ...base, thumbnailUrl })).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  test('miniatura acima do teto é descartada', async () => {
    handler = () => new Response(new Uint8Array(THUMB_MAX_BYTES + 1), { status: 200 });
    expect(await plexSource.thumb?.({ ...base, thumbnailUrl: '/library/metadata/501/thumb/1700000000' })).toBeNull();
  });
});

