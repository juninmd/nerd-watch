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
