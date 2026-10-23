import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { listsRoutes } from '../src/server/routes/lists.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
  resetDbForTests(db);
});

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const send = (path: string, init: RequestInit = {}) => listsRoutes.request(path, init);

const createList = async (name = 'Terror'): Promise<{ id: string }> => {
  const res = await send('/', json({ name }));
  expect(res.status).toBe(201);
  return res.json();
};

const addTitle = (sourceId: string): string =>
  upsertTitle(db, { source: 'tmdb', sourceId, mediaType: 'movie', title: `Filme ${sourceId}`, posterPath: `/p${sourceId}.jpg` }).id;

describe('POST /api/lists: validação', () => {
  test('cria com nome válido e devolve 201', async () => {
    const res = await send('/', json({ name: '  Favoritos  ', description: 'os melhores' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Favoritos', description: 'os melhores', itemCount: 0 });
  });

  test('recusa nome vazio, longo demais, tipo errado e chaves desconhecidas', async () => {
    for (const body of [{ name: '' }, { name: 'a'.repeat(81) }, { name: 42 }, { name: 'ok', owner: 'eu' }, { name: 'ok', description: 'x'.repeat(501) }]) {
      expect((await send('/', json(body))).status).toBe(400);
    }
  });

  test('JSON malformado e corpo acima do teto (413) não chegam ao banco', async () => {
    const bad = await send('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nao-json' });
    expect(bad.status).toBe(400);
    const huge = await send('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a', description: 'x'.repeat(20_000) }) });
    expect(huge.status).toBe(413);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lists').get()?.n).toBe(0);
  });

  test('nome com cara de SQL é guardado e devolvido como texto; a tabela continua existindo', async () => {
    const hostile = `'); DROP TABLE lists;--`;
    const created = await (await send('/', json({ name: hostile }))).json();
    const again = await (await send(`/${created.id}`)).json();
    expect(again.list.name).toBe(hostile);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lists').get()?.n).toBe(1);
  });
});

describe('GET /api/lists: paginação', () => {
  test('limit e offset fora da faixa são 400', async () => {
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=1.5']) {
      expect((await send(`/?${q}`)).status).toBe(400);
    }
  });

  test('lista página, informa total e marca containsTitle quando pedido', async () => {
    const titleId = addTitle('1');
    const a = await createList('A');
    await createList('B');
    await send(`/${a.id}/items`, json({ titleIds: [titleId] }));
    const page = await (await send(`/?limit=1&titleId=${titleId}`)).json();
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    const all = await (await send(`/?titleId=${titleId}`)).json();
    expect(all.items.find((i: { name: string }) => i.name === 'A').containsTitle).toBe(true);
    expect(all.items.find((i: { name: string }) => i.name === 'B').containsTitle).toBe(false);
  });

  test('capas trazem até 4 pôsteres na ordem da lista', async () => {
    const ids = ['1', '2', '3', '4', '5'].map(addTitle);
    const list = await createList();
    await send(`/${list.id}/items`, json({ titleIds: ids }));
    const [summary] = (await (await send('/')).json()).items;
    expect(summary.itemCount).toBe(5);
    expect(summary.covers.map((c: { posterUrl: string | null }) => c.posterUrl)).toHaveLength(4);
    expect(summary.covers[0].posterUrl).toContain('/p1.jpg');
  });
});

describe('itens: adicionar, remover, reordenar', () => {
  test('adicionar em lote é idempotente e informa quantos já estavam', async () => {
    const [a, b] = ['1', '2'].map(addTitle) as [string, string];
    const list = await createList();
    const first = await (await send(`/${list.id}/items`, json({ titleIds: [a, b] }))).json();
    expect(first).toEqual({ added: 2, existing: 0 });
    const second = await (await send(`/${list.id}/items`, json({ titleIds: [a, b] }))).json();
    expect(second).toEqual({ added: 0, existing: 2 });
  });

  test('lote vazio, acima de 500, com id inválido ou título inexistente é 400', async () => {
    const list = await createList();
    const a = addTitle('1');
    expect((await send(`/${list.id}/items`, json({ titleIds: [] }))).status).toBe(400);
    expect((await send(`/${list.id}/items`, json({ titleIds: Array.from({ length: 501 }, (_, i) => `t${i}`) }))).status).toBe(400);
    expect((await send(`/${list.id}/items`, json({ titleIds: [''] }))).status).toBe(400);
    expect((await send(`/${list.id}/items`, json({ titleIds: [a, 'fantasma'] }))).status).toBe(400);
    expect((await send(`/${list.id}`)).status).toBe(200);
    expect((await (await send(`/${list.id}`)).json()).total).toBe(0);
  });

  test('lista inexistente é 404 em todas as rotas de item', async () => {
    const a = addTitle('1');
    expect((await send('/nao-existe/items', json({ titleIds: [a] }))).status).toBe(404);
    expect((await send(`/nao-existe/items/${a}`, { method: 'DELETE' })).status).toBe(404);
    expect((await send('/nao-existe/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titleIds: [a] }) })).status).toBe(404);
  });

  test('remover item devolve 204; remover de novo devolve 404', async () => {
    const a = addTitle('1');
    const list = await createList();
    await send(`/${list.id}/items`, json({ titleIds: [a] }));
    expect((await send(`/${list.id}/items/${a}`, { method: 'DELETE' })).status).toBe(204);
    expect((await send(`/${list.id}/items/${a}`, { method: 'DELETE' })).status).toBe(404);
  });

  test('reordenar: ordem válida vale; duplicado, faltando ou de fora é 400 e nada muda', async () => {
    const [a, b, c] = ['1', '2', '3'].map(addTitle) as [string, string, string];
    const list = await createList();
    await send(`/${list.id}/items`, json({ titleIds: [a, b, c] }));
    const put = (ids: string[]) => send(`/${list.id}/order`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titleIds: ids }) });

    expect((await put([c, a, b])).status).toBe(200);
    expect((await put([a, a, b])).status).toBe(400);
    expect((await put([c, a])).status).toBe(400);
    expect((await put([c, a, 'x'])).status).toBe(400);
    const detail = await (await send(`/${list.id}`)).json();
    expect(detail.items.map((i: { titleId: string }) => i.titleId)).toEqual([c, a, b]);
  });
});

describe('detalhe e exclusão', () => {
  test('GET de lista inexistente é 404; PATCH com chave extra é 400', async () => {
    expect((await send('/nao-existe')).status).toBe(404);
    const list = await createList();
    const res = await send(`/${list.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', id: 'outro' }) });
    expect(res.status).toBe(400);
  });

  test('DELETE remove a lista e os itens somem junto; títulos continuam', async () => {
    const a = addTitle('1');
    const list = await createList();
    await send(`/${list.id}/items`, json({ titleIds: [a] }));
    expect((await send(`/${list.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await send(`/${list.id}`)).status).toBe(404);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM list_items').get()?.n).toBe(0);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n).toBe(1);
  });
});
