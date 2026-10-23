import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const addBody = { source: 'tmdb', sourceId: '42', mediaType: 'movie', title: 'Filme Teste' };

const add = async (watchStatus?: string): Promise<{ titleId: string }> =>
  (await (await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify({ ...addBody, watchStatus }) })).json()) as { titleId: string };

const setStatus = (titleId: string, watchStatus: string) =>
  libraryRoutes.request(`/${titleId}`, { method: 'PATCH', body: JSON.stringify({ watchStatus }) });

const history = (titleId: string, query = '') => libraryRoutes.request(`/${titleId}/history${query}`);

describe('GET /api/library/:titleId/history', () => {
  test('devolve os eventos do mais novo para o mais antigo, com total e paginação', async () => {
    const { titleId } = await add('want');
    await setStatus(titleId, 'watching');
    await setStatus(titleId, 'watched');

    const body = await (await history(titleId, '?limit=2&offset=0')).json();
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['finished', 'started']);
    expect(body.items[0]).toEqual(expect.objectContaining({ id: expect.any(String), at: expect.any(String), detail: null }));

    const rest = await (await history(titleId, '?limit=2&offset=2')).json();
    expect(rest.items.map((i: { kind: string }) => i.kind)).toEqual(['added']);
  });

  test('usa limite padrão quando não informado', async () => {
    const { titleId } = await add('want');
    const body = await (await history(titleId)).json();
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  test.each([
    ['limite zero', '?limit=0'],
    ['limite acima do máximo', '?limit=101'],
    ['limite não numérico', '?limit=abc'],
    ['limite fracionário', '?limit=1.5'],
    ['offset negativo', '?offset=-1'],
    ['offset não numérico', '?offset=x'],
  ])('rejeita %s com 400', async (_label, query) => {
    const { titleId } = await add('want');
    expect((await history(titleId, query)).status).toBe(400);
  });

  test('aceita exatamente o limite máximo de 100', async () => {
    const { titleId } = await add('want');
    expect((await history(titleId, '?limit=100')).status).toBe(200);
  });

  test('título sem histórico devolve lista vazia', async () => {
    const res = await history('inexistente');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });
});

describe('POST /api/library/:titleId/rewatch', () => {
  const rewatch = (titleId: string) => libraryRoutes.request(`/${titleId}/rewatch`, { method: 'POST' });

  test('a partir de assistido: volta a assistindo e expõe rewatchCount', async () => {
    const { titleId } = await add('watched');
    const res = await rewatch(titleId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.watchStatus).toBe('watching');
    expect(body.rewatchCount).toBe(1);
  });

  test('rejeita com 409 quando o título não está assistido', async () => {
    const { titleId } = await add('watching');
    const res = await rewatch(titleId);
    expect(res.status).toBe(409);
    expect((await (await libraryRoutes.request('/')).json()).items[0].rewatchCount).toBe(0);
  });

  test('título fora da lista devolve 404', async () => {
    expect((await rewatch('inexistente')).status).toBe(404);
  });

  test('a rota de histórico mostra o rewatch_started depois da ação', async () => {
    const { titleId } = await add('watched');
    await rewatch(titleId);
    const body = await (await history(titleId)).json();
    expect(body.items[0].kind).toBe('rewatch_started');
  });
});
