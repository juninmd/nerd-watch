import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { SAVED_VIEWS_MAX } from '../src/server/repo/saved-views.ts';
import { savedViewsRoutes } from '../src/server/routes/saved-views.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
  resetDbForTests(db);
});

const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const patch = (body: unknown) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const send = (path: string, init: RequestInit = {}) => savedViewsRoutes.request(path, init);

const create = async (name: string, query: Record<string, string> = { status: 'want' }) => {
  const res = await send('/', post({ name, query }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string; query: Record<string, string> };
};

describe('POST /api/views: validação da visão', () => {
  test('cria com nome e combinação válidos; campos ausentes usam o padrão', async () => {
    const view = await create('Quero ver de terror', { status: 'want', source: 'tmdb' });
    expect(view.query).toEqual({ status: 'want', source: 'tmdb', layout: 'grid', sort: 'recent' });
  });

  test('recusa chave desconhecida no topo e dentro da combinação', async () => {
    expect((await send('/', post({ name: 'a', query: {}, owner: 'x' }))).status).toBe(400);
    expect((await send('/', post({ name: 'a', query: { status: 'all', extra: 1 } }))).status).toBe(400);
  });

  test('recusa valores fora da lista branca e cara de SQL ou HTML (nada chega ao banco)', async () => {
    for (const query of [{ status: "watched' OR '1'='1" }, { sort: 'title; DROP TABLE saved_views' }, { layout: '<script>' }, { status: 'WATCHED' }]) {
      expect((await send('/', post({ name: 'ok', query }))).status).toBe(400);
    }
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM saved_views').get()?.n).toBe(0);
  });

  test('recusa nome vazio, longo, com quebra de linha, ou não-texto', async () => {
    for (const name of ['', '   ', 'a'.repeat(41), 'linha\nnova', 7, null]) {
      expect((await send('/', post({ name, query: {} }))).status).toBe(400);
    }
  });

  test('recusa JSON malformado, corpo que é lista e corpo acima do teto (413)', async () => {
    expect((await send('/', post('{quebrado'))).status).toBe(400);
    expect((await send('/', post(['x']))).status).toBe(400);
    expect((await send('/', post({ name: 'a', query: { status: 'all' }, pad: 'x'.repeat(20_000) }))).status).toBe(413);
  });

  test('nome com cara de injeção é guardado como texto', async () => {
    const hostile = `x' OR 1=1 --`;
    const view = await create(hostile);
    expect(view.name).toBe(hostile);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM saved_views').get()?.n).toBe(1);
  });

  test('há um teto de visões salvas; passar dele é 400 com mensagem clara', async () => {
    for (let i = 0; i < SAVED_VIEWS_MAX; i++) await create(`v${i}`);
    const res = await send('/', post({ name: 'a mais', query: {} }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(String(SAVED_VIEWS_MAX));
  });
});

describe('GET, PATCH e DELETE /api/views', () => {
  test('lista todas as visões com a combinação já decodificada', async () => {
    await create('B', { status: 'watched' });
    await create('A', { sort: 'rating' });
    const body = (await (await send('/')).json()) as { items: Array<{ name: string; query: { sort: string } }> };
    expect(body.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(body.items[0]?.query.sort).toBe('rating');
  });

  test('renomeia e troca a combinação; campo ausente fica como está', async () => {
    const view = await create('Antiga', { status: 'want' });
    const res = await send(`/${view.id}`, patch({ name: 'Nova' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Nova', query: { status: 'want' } });
    const changed = await send(`/${view.id}`, patch({ query: { status: 'watched' } }));
    expect(await changed.json()).toMatchObject({ name: 'Nova', query: { status: 'watched' } });
  });

  test('PATCH inválido é 400; visão inexistente é 404 em PATCH e DELETE', async () => {
    const view = await create('X');
    expect((await send(`/${view.id}`, patch({ query: { status: 'apagar' } }))).status).toBe(400);
    expect((await send(`/${view.id}`, patch({ id: 'outro' }))).status).toBe(400);
    expect((await send('/nao-existe', patch({ name: 'y' }))).status).toBe(404);
    expect((await send('/nao-existe', { method: 'DELETE' })).status).toBe(404);
  });

  test('DELETE remove a visão e não mexe nas outras', async () => {
    const a = await create('A');
    const b = await create('B');
    expect((await send(`/${a.id}`, { method: 'DELETE' })).status).toBe(204);
    const names = ((await (await send('/')).json()) as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(names).toEqual([b.id]);
  });
});
