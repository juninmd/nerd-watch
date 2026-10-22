import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const addBody = {
  source: 'tmdb' as const,
  sourceId: '42',
  mediaType: 'movie' as const,
  title: 'Filme Teste',
};

describe('POST /api/library', () => {
  test('cria uma entrada nova com status padrão "want"', async () => {
    const res = await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify(addBody) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.watchStatus).toBe('want');
    expect(body.title.title).toBe('Filme Teste');
  });

  test('rejeita corpo sem os campos obrigatórios', async () => {
    const res = await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify({ title: 'sem source' }) });
    expect(res.status).toBe(400);
  });

  test('rejeita watchStatus inválido', async () => {
    const res = await libraryRoutes.request('/', {
      method: 'POST',
      body: JSON.stringify({ ...addBody, watchStatus: 'inventado' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/library', () => {
  test('lista itens adicionados e filtra por status', async () => {
    await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify(addBody) });
    await libraryRoutes.request('/', {
      method: 'POST',
      body: JSON.stringify({ ...addBody, sourceId: '43', watchStatus: 'watching' }),
    });

    const all = await (await libraryRoutes.request('/')).json();
    expect(all.items).toHaveLength(2);

    const watching = await (await libraryRoutes.request('/?status=watching')).json();
    expect(watching.items).toHaveLength(1);
  });

  test('rejeita status inválido na query', async () => {
    const res = await libraryRoutes.request('/?status=invalido');
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/library/:titleId', () => {
  test('atualiza status e progresso', async () => {
    const created = await (await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify(addBody) })).json();
    const res = await libraryRoutes.request(`/${created.titleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ watchStatus: 'watching', currentEpisode: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.watchStatus).toBe('watching');
    expect(body.currentEpisode).toBe(3);
  });

  test('rejeita rating fora do intervalo 0-10', async () => {
    const created = await (await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify(addBody) })).json();
    const res = await libraryRoutes.request(`/${created.titleId}`, { method: 'PATCH', body: JSON.stringify({ rating: 11 }) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/library/:entryId', () => {
  test('remove a entrada e devolve 204', async () => {
    const created = await (await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify(addBody) })).json();
    const res = await libraryRoutes.request(`/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const list = await (await libraryRoutes.request('/')).json();
    expect(list.items).toHaveLength(0);
  });
});

describe('POST /api/library/bulk', () => {
  const bulk = (body: unknown) => libraryRoutes.request('/bulk', { method: 'POST', body: JSON.stringify(body) });
  const add = async (sourceId: string) =>
    (await (await libraryRoutes.request('/', { method: 'POST', body: JSON.stringify({ ...addBody, sourceId }) })).json()) as { titleId: string };

  test('muda o status de vários itens de uma vez e ignora ids sem entrada', async () => {
    const [a, b] = [await add('1'), await add('2')];
    const res = await bulk({ titleIds: [a.titleId, b.titleId, 'inexistente'], action: 'status', watchStatus: 'watched' });
    expect(await res.json()).toEqual({ affected: 2 });
    const list = await (await libraryRoutes.request('/?status=watched')).json();
    expect(list.items).toHaveLength(2);
  });

  test('remove só os selecionados, preservando o resto da lista', async () => {
    const [a, b] = [await add('1'), await add('2')];
    const res = await bulk({ titleIds: [a.titleId], action: 'remove' });
    expect(await res.json()).toEqual({ affected: 1 });
    const list = await (await libraryRoutes.request('/')).json();
    expect(list.items.map((i: { titleId: string }) => i.titleId)).toEqual([b.titleId]);
  });

  test.each([
    ['titleIds ausente', { action: 'remove' }],
    ['titleIds com valor não-string', { titleIds: [1], action: 'remove' }],
    ['ação desconhecida', { titleIds: ['x'], action: 'apagar-tudo' }],
    ['status sem watchStatus válido', { titleIds: ['x'], action: 'status', watchStatus: 'inventado' }],
    ['lote acima do limite', { titleIds: Array.from({ length: 501 }, (_, i) => `id${i}`), action: 'remove' }],
  ])('rejeita %s', async (_label, body) => {
    expect((await bulk(body)).status).toBe(400);
  });

  test('lista vazia não altera nada', async () => {
    await add('1');
    expect(await (await bulk({ titleIds: [], action: 'remove' })).json()).toEqual({ affected: 0 });
    expect((await (await libraryRoutes.request('/')).json()).items).toHaveLength(1);
  });
});
