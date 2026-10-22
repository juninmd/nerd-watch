import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { type JellyfinItem, normalizeGuid, toItems } from '../src/server/providers/jellyfin/api.ts';
import { jellyfinSource, registerJellyfin } from '../src/server/providers/jellyfin/source.ts';
import { restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import { setMediaFetchForTests, THUMB_MAX_BYTES } from '../src/server/providers/sources/media-server.ts';
import type { SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';

/** Fixture só de teste: token óbvio e IDs inventados no formato GUID do Jellyfin. */
const TOKEN = 'fake-token';
const BASE = 'http://192.168.0.10:8096';
const LIB = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const EPISODE_ID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const MOVIE_ID = 'ffeeddccbbaa99887766554433221100';

const snapshot = snapshotRegistry();
const calls: Array<{ url: URL; init: RequestInit }> = [];
let handler: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json({});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const headerOf = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);
const itemsResponse = (items: JellyfinItem[], total = items.length) => json({ Items: items, TotalRecordCount: total });

const episode: JellyfinItem = {
  Id: EPISODE_ID,
  Name: 'O Início',
  Type: 'Episode',
  SeriesName: 'Bleach',
  ParentIndexNumber: 1,
  IndexNumber: 9,
  RunTimeTicks: 15_000_000_000,
  DateCreated: '2026-10-19T12:00:00.0000000Z',
  ImageTags: { Primary: 'tag-1' },
};
const movie: JellyfinItem = { Id: MOVIE_ID, Name: 'Filme X', Type: 'Movie', DateCreated: '2026-09-01T00:00:00.0000000Z' };

beforeAll(() => registerJellyfin());
afterAll(() => restoreRegistry(snapshot));

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  calls.length = 0;
  handler = () => json({});
  process.env.JELLYFIN_URL = BASE;
  process.env.JELLYFIN_API_KEY = TOKEN;
  setMediaFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  });
});

afterEach(() => {
  setMediaFetchForTests();
  delete process.env.JELLYFIN_URL;
  delete process.env.JELLYFIN_API_KEY;
});

const post = (path: string, body: unknown) => sourcesRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('biblioteca (add.input)', () => {
  test('acha pelo nome sem diferença de caixa e grava o handle com prefixo', async () => {
    handler = () => json([{ Name: 'Séries', ItemId: LIB }, { Name: 'Filmes', ItemId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }]);
    expect(await jellyfinSource.resolve('  séries ')).toEqual({ handle: `jellyfin:${LIB}`, name: 'Séries' });
  });

  test('aceita o ID com ou sem traços e confere pelo /Items?ids=', async () => {
    handler = () => itemsResponse([{ Id: LIB, Name: 'Coleção Retrô' }]);
    const withDashes = 'a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90';
    expect(await jellyfinSource.resolve(withDashes)).toEqual({ handle: `jellyfin:${LIB}`, name: 'Coleção Retrô' });
    expect(calls[0]?.url.searchParams.get('ids')).toBe(LIB);
  });

  test('nome que não existe é 404 e a mensagem não ecoa a entrada', async () => {
    handler = () => json([{ Name: 'Séries', ItemId: LIB }]);
    const err = await jellyfinSource.resolve('Inexistente').catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(404);
  });

  test.each(['../../System/Info', "x';DROP TABLE", 'a;b&c=d', '%2e%2e/%2e%2e'])('entrada hostil %s nunca vira caminho: só a lista de bibliotecas é consultada', async (input) => {
    handler = () => json([{ Name: 'Séries', ItemId: LIB }]);
    await jellyfinSource.resolve(input).catch(() => undefined);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/Library/VirtualFolders']);
  });

  test('entrada absurdamente longa é recusada antes de qualquer chamada', async () => {
    const err = await jellyfinSource.resolve('x'.repeat(500)).catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('listagem', () => {
  const handle = `jellyfin:${LIB}`;

  test('pede vídeos da biblioteca, recursivo, do mais novo ao mais antigo, com DateCreated', async () => {
    handler = () => itemsResponse([movie]);
    await jellyfinSource.list(handle);
    const q = calls[0]?.url.searchParams;
    expect(q?.get('ParentId')).toBe(LIB);
    expect(q?.get('Recursive')).toBe('true');
    expect(q?.get('IncludeItemTypes')?.split(',').sort()).toEqual(['Episode', 'Movie', 'Video']);
    expect(q?.get('SortBy')).toBe('DateCreated');
    expect(q?.get('SortOrder')).toBe('Descending');
  });

  test('pagina: 450 itens em três chamadas, com StartIndex e Limit corretos', async () => {
    handler = (url) => {
      const start = Number(url.searchParams.get('StartIndex'));
      const size = Number(url.searchParams.get('Limit'));
      const page = Array.from({ length: Math.min(size, 450 - start) }, (_, i) => ({ Id: String(start + i).padStart(32, '0'), Name: `F${start + i}`, Type: 'Movie' }) as JellyfinItem);
      return itemsResponse(page, 450);
    };
    const items = await jellyfinSource.list(handle);
    expect(items).toHaveLength(450);
    expect(calls.map((c) => [c.url.searchParams.get('StartIndex'), c.url.searchParams.get('Limit')])).toEqual([
      ['0', '200'],
      ['200', '200'],
      ['400', '100'],
    ]);
  });

  test('catálogo enorme para no teto de 500 itens e no máximo três requisições', async () => {
    handler = (url) => {
      const start = Number(url.searchParams.get('StartIndex'));
      const size = Number(url.searchParams.get('Limit'));
      return itemsResponse(Array.from({ length: size }, (_, i) => ({ Id: `${String(start + i).padStart(32, '0')}`, Name: `F${start + i}`, Type: 'Movie' }) as JellyfinItem), 9000);
    };
    expect(await jellyfinSource.list(handle)).toHaveLength(500);
    expect(calls).toHaveLength(3);
  });

  test('episódio vira "Série SxxEyy — Nome" e filme só o nome; duração vem de ticks', () => {
    const [ep, mv] = toItems([episode, movie]);
    expect(ep).toMatchObject({ caption: 'Bleach S01E09 — O Início', durationSeconds: 1500, fileRef: normalizeGuid(EPISODE_ID), postedAt: '2026-10-19T12:00:00.0000000Z' });
    expect(mv).toMatchObject({ caption: 'Filme X', durationSeconds: null, fileRef: MOVIE_ID });
  });

  test('messageId cresce com a data de criação (é o que ordena no app) e é estável', () => {
    const [older, newer] = toItems([movie, episode]);
    expect(Number(newer?.messageId)).toBeGreaterThan(Number(older?.messageId));
    expect(toItems([movie])[0]?.messageId).toBe(older?.messageId);
  });

  test('item com ID malformado é descartado em vez de virar fileRef', () => {
    const items = toItems([{ Id: '../../etc/passwd', Name: 'x' }, { Id: `${MOVIE_ID};rm`, Name: 'y' }, movie]);
    expect(items.map((i) => i.fileRef)).toEqual([MOVIE_ID]);
  });

  test('handle malformado no banco é 404 sem chamada ao servidor', async () => {
    for (const bad of ['jellyfin:../../x', 'jellyfin:;drop', 'plex:1', '']) {
      const err = await jellyfinSource.list(bad).catch((e: unknown) => e);
      expect((err as SourceError).status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  test('criar canal pela rota grava o canal e importa os itens', async () => {
    handler = (url) => (url.pathname === '/Library/VirtualFolders' ? json([{ Name: 'Séries', ItemId: LIB }]) : itemsResponse([episode, movie]));
    const res = await post('/jellyfin/channels', { input: 'Séries' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ mode: 'jellyfin', title: 'Séries', itemCount: 2, link: null });
  });
});

describe('reprodução', () => {
  const ref = MOVIE_ID;

  test('repassa o Range e o arquivo original (static=true), devolvendo 206 com Content-Range', async () => {
    handler = () => new Response('abcd', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/10', 'Set-Cookie': 'sessao=1' } });
    const res = await jellyfinSource.play({ handle: `jellyfin:${LIB}`, fileRef: ref, range: 'bytes=0-3' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-3/10');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(calls[0]?.url.pathname).toBe(`/Videos/${ref}/stream`);
    expect(calls[0]?.url.searchParams.get('static')).toBe('true');
    expect(headerOf(calls[0]?.init ?? {}, 'Range')).toBe('bytes=0-3');
  });

  test('Range fora do formato bytes=a-b não chega ao servidor', async () => {
    handler = () => new Response('x', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    await jellyfinSource.play({ handle: `jellyfin:${LIB}`, fileRef: ref, range: 'bytes=0-1,3-4\r\nX-Evil: 1' });
    expect(headerOf(calls[0]?.init ?? {}, 'Range')).toBeNull();
  });

  test('ID malformado no play (../, ;) é 404 e não gera requisição', async () => {
    for (const bad of ['../../System/Info', `${MOVIE_ID};x`, '']) {
      const err = await jellyfinSource.play({ handle: `jellyfin:${LIB}`, fileRef: bad, range: undefined }).catch((e: unknown) => e);
      expect((err as SourceError).status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  test('redirect para outra origem não é seguido: 502 em uma chamada, sem o cabeçalho de autenticação indo embora', async () => {
    handler = () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/steal' } });
    const res = await jellyfinSource.play({ handle: `jellyfin:${LIB}`, fileRef: ref, range: undefined });
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(await res.text()).not.toContain('evil.example');
  });

  test('item que sumiu do servidor é 404 com a mensagem do Jellyfin', async () => {
    handler = () => new Response('', { status: 404 });
    const res = await jellyfinSource.play({ handle: `jellyfin:${LIB}`, fileRef: ref, range: undefined });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'vídeo não encontrado no Jellyfin' });
  });

  test('servidor fora do ar vira 502 com mensagem nossa, sem o erro de rede cru', async () => {
    setMediaFetchForTests(async () => {
      throw new TypeError('connect ECONNREFUSED 192.168.0.10:8096');
    });
    const err = await jellyfinSource.list(`jellyfin:${LIB}`).catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(502);
    expect((err as SourceError).message).toBe('não alcancei o servidor agora — confira o endereço em Conexões');
  });
});

describe('miniatura', () => {
  const base = { handle: `jellyfin:${LIB}`, fileRef: MOVIE_ID };

  test('baixa a capa primária reduzida no servidor, com a chave só no cabeçalho', async () => {
    handler = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    const bytes = await jellyfinSource.thumb?.({ ...base, thumbnailUrl: `/Items/${MOVIE_ID}/Images/Primary` });
    expect(Array.from(bytes ?? [])).toEqual([0xff, 0xd8, 0xff]);
    expect(calls[0]?.url.pathname).toBe(`/Items/${MOVIE_ID}/Images/Primary`);
    expect(calls[0]?.url.searchParams.get('maxHeight')).toBe('480');
  });

  test('item sem capa no servidor não gera requisição', async () => {
    expect(await jellyfinSource.thumb?.({ ...base, thumbnailUrl: null })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('capa maior que o teto é descartada e nunca fica inteira em memória', async () => {
    handler = () => new Response(new Uint8Array(THUMB_MAX_BYTES + 1), { status: 200 });
    expect(await jellyfinSource.thumb?.({ ...base, thumbnailUrl: `/Items/${MOVIE_ID}/Images/Primary` })).toBeNull();
  });

  test('capa com erro no servidor vira null (enriquecimento, não derruba a importação)', async () => {
    handler = () => new Response('erro', { status: 500 });
    expect(await jellyfinSource.thumb?.({ ...base, thumbnailUrl: `/Items/${MOVIE_ID}/Images/Primary` })).toBeNull();
  });
});

