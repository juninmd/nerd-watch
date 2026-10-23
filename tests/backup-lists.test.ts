import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { createSavedView } from '../src/server/repo/saved-views.ts';
import { addTitlesToList, createList } from '../src/server/repo/lists.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import { backupRoutes } from '../src/server/routes/backup.ts';

let db: Database;

/** Troca para um banco vazio: o backup usa o singleton de `getDb()`, então o teste precisa apontar para ele. */
const freshDb = (): void => {
  db = openDb(':memory:');
  resetDbForTests(db);
};

beforeEach(freshDb);

const exportDump = async () => (await backupRoutes.request('/')).json();
const importDump = (dump: unknown) => backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
const count = (table: string): number => db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;

const seed = () => {
  const a = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'A' });
  const b = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'tv', title: 'B' });
  const list = createList(db, { name: 'Favoritos', description: 'os melhores' });
  addTitlesToList(db, list.id, [b.id, a.id]);
  createSavedView(db, { name: 'Quero ver', query: { status: 'want', source: 'all', layout: 'list', sort: 'title' } });
  return { a, b, list };
};

describe('backup de listas e visões salvas', () => {
  test('exporta listas, itens (com posição) e visões salvas', async () => {
    seed();
    const dump = await exportDump();
    expect(dump.lists).toHaveLength(1);
    expect(dump.listItems).toHaveLength(2);
    expect(dump.savedViews).toHaveLength(1);
  });

  test('restaura em banco vazio preservando ids e a ordem dos itens', async () => {
    const { list, b, a } = seed();
    const dump = await exportDump();

    freshDb();
    const res = await importDump(dump);
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toMatchObject({ lists: 1, savedViews: 1 });

    const order = db.query<{ title_id: string }, [string]>('SELECT title_id FROM list_items WHERE list_id = ? ORDER BY position').all(list.id);
    expect(order.map((r) => r.title_id)).toEqual([b.id, a.id]);
  });

  test('reimportar o mesmo backup não duplica listas, itens nem visões', async () => {
    seed();
    const dump = await exportDump();
    await importDump(dump);
    await importDump(dump);
    expect(count('lists')).toBe(1);
    expect(count('list_items')).toBe(2);
    expect(count('saved_views')).toBe(1);
  });

  test('reimportar um backup antigo não apaga lista criada depois (ON CONFLICT, não OR REPLACE)', async () => {
    seed();
    const oldDump = await exportDump();
    const later = createList(db, { name: 'Criada depois', description: null });
    await importDump(oldDump);
    expect(db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM lists WHERE id = ?').get(later.id)?.n).toBe(1);
  });
});

describe('backup legado (sem listas nem visões)', () => {
  test('um backup anterior importa normalmente e não toca nas listas existentes', async () => {
    seed();
    const legacy = await exportDump();
    delete legacy.lists;
    delete legacy.listItems;
    delete legacy.savedViews;
    const keep = createList(db, { name: 'Continua aqui', description: null });

    const res = await importDump(legacy);
    expect(res.status).toBe(200);
    expect((await res.json()).imported).toMatchObject({ lists: 0, savedViews: 0 });
    expect(db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM lists WHERE id = ?').get(keep.id)?.n).toBe(1);
  });
});

describe('backup com dados inválidos: nada é importado', () => {
  test('nome de lista vazio, com quebra de linha ou longo demais é recusado', async () => {
    seed();
    const good = await exportDump();
    for (const bad of [{ name: '' }, { name: 'quebra\nlinha' }, { name: 'x'.repeat(81) }]) {
      const dump = structuredClone(good);
      dump.lists[0] = { ...dump.lists[0], ...bad };
      freshDb();
      expect((await importDump(dump)).status).toBe(400);
      expect(count('titles')).toBe(0);
    }
  });

  test('visão com chave desconhecida, valor fora da lista branca ou texto que não é JSON é recusada', async () => {
    seed();
    const good = await exportDump();
    for (const query of ['{"status":"watched\' OR 1=1"}', '{"status":"all","drop":"x"}', 'não é json']) {
      const dump = structuredClone(good);
      dump.savedViews[0] = { ...dump.savedViews[0], query };
      freshDb();
      expect((await importDump(dump)).status).toBe(400);
      expect(count('lists')).toBe(0);
    }
  });

  test('item apontando para título inexistente falha a importação inteira (FK)', async () => {
    seed();
    const dump = await exportDump();
    dump.listItems = [{ list_id: dump.lists[0].id, title_id: 'nao-existe', position: 0, added_at: '2026-01-01T00:00:00.000Z' }];
    freshDb();
    expect((await importDump(dump)).status).toBe(400);
    expect(count('lists')).toBe(0);
  });

  test('posição negativa, fracionária ou texto em item é recusada', async () => {
    seed();
    const good = await exportDump();
    for (const position of [-1, 1.5, '2']) {
      const dump = structuredClone(good);
      dump.listItems[0] = { ...dump.listItems[0], position };
      freshDb();
      expect((await importDump(dump)).status).toBe(400);
    }
  });
});
