import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { addTitlesToList, createList, deleteList, getListPage, listNamesByTitle, listSummaries, removeTitleFromList, reorderList, updateList } from '../src/server/repo/lists.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import { ValidationError } from '../src/server/validation-error.ts';
import { LIST_ITEMS_MAX } from '../src/server/lists/rules.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

const makeTitles = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => upsertTitle(db, { source: 'tmdb', sourceId: String(i + 1), mediaType: 'movie', title: `Filme ${i + 1}` }).id);

const orderOf = (listId: string): string[] => (getListPage(db, listId, { limit: 1000, offset: 0 })?.items ?? []).map((i) => i.titleId);

describe('listas: criação e edição', () => {
  test('cria, renomeia e descreve uma lista', () => {
    const list = createList(db, { name: 'Terror', description: null });
    expect(list.name).toBe('Terror');
    const renamed = updateList(db, list.id, { name: 'Terror clássico', description: 'anos 70' });
    expect(renamed).toMatchObject({ name: 'Terror clássico', description: 'anos 70' });
    expect(updateList(db, 'nao-existe', { name: 'x' })).toBeNull();
  });

  test('o banco também recusa nome vazio ou longo demais (defesa em profundidade)', () => {
    expect(() => db.query(`INSERT INTO lists (id, name, created_at, updated_at) VALUES ('a', '', 'x', 'x')`).run()).toThrow();
    expect(() => db.query(`INSERT INTO lists (id, name, created_at, updated_at) VALUES ('b', ?, 'x', 'x')`).run('a'.repeat(81))).toThrow();
  });
});

describe('listas: itens', () => {
  test('adicionar é idempotente: o mesmo título duas vezes não duplica nem muda a posição', () => {
    const [a, b] = makeTitles(2) as [string, string];
    const list = createList(db, { name: 'L', description: null });
    expect(addTitlesToList(db, list.id, [a, b])).toEqual({ added: 2, existing: 0 });
    expect(addTitlesToList(db, list.id, [a, b, a])).toEqual({ added: 0, existing: 2 });
    expect(orderOf(list.id)).toEqual([a, b]);
  });

  test('novos itens entram no fim, mesmo depois de remoções (sem colidir posições)', () => {
    const [a, b, c, d] = makeTitles(4) as [string, string, string, string];
    const list = createList(db, { name: 'L', description: null });
    addTitlesToList(db, list.id, [a, b, c]);
    expect(removeTitleFromList(db, list.id, a)).toBe(true);
    expect(removeTitleFromList(db, list.id, a)).toBe(false);
    addTitlesToList(db, list.id, [d]);
    expect(orderOf(list.id)).toEqual([b, c, d]);
  });

  test('título inexistente é recusado e nenhum item do lote entra (transação)', () => {
    const [a] = makeTitles(1) as [string];
    const list = createList(db, { name: 'L', description: null });
    expect(() => addTitlesToList(db, list.id, [a, 'fantasma'])).toThrow(ValidationError);
    expect(orderOf(list.id)).toEqual([]);
  });

  test('respeita o teto de itens por lista', () => {
    const ids = makeTitles(3);
    const list = createList(db, { name: 'L', description: null });
    db.query(`INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, 0, 'x')`).run(list.id, ids[0] ?? null);
    // Preenche até o teto diretamente, para não criar mil títulos no teste.
    db.exec('PRAGMA foreign_keys = OFF;');
    for (let i = 1; i < LIST_ITEMS_MAX; i++) db.query(`INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, ?, 'x')`).run(list.id, `t${i}`, i);
    db.exec('PRAGMA foreign_keys = ON;');
    expect(() => addTitlesToList(db, list.id, [ids[1] ?? ''])).toThrow(ValidationError);
  });
});

describe('listas: reordenação em uma transação', () => {
  test('aplica a nova ordem e grava posições 0..n-1', () => {
    const [a, b, c] = makeTitles(3) as [string, string, string];
    const list = createList(db, { name: 'L', description: null });
    addTitlesToList(db, list.id, [a, b, c]);
    expect(reorderList(db, list.id, [c, a, b])).toEqual([c, a, b]);
    expect(orderOf(list.id)).toEqual([c, a, b]);
    const positions = db.query<{ position: number }, [string]>('SELECT position FROM list_items WHERE list_id = ? ORDER BY position').all(list.id);
    expect(positions.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  test('ordem com duplicado, item faltando ou de outra lista não muda nada', () => {
    const [a, b, c] = makeTitles(3) as [string, string, string];
    const list = createList(db, { name: 'L', description: null });
    addTitlesToList(db, list.id, [a, b]);
    expect(() => reorderList(db, list.id, [a, a])).toThrow(ValidationError);
    expect(() => reorderList(db, list.id, [a])).toThrow(ValidationError);
    expect(() => reorderList(db, list.id, [a, c])).toThrow(ValidationError);
    expect(orderOf(list.id)).toEqual([a, b]);
  });

  test('posições repetidas no banco são desempatadas de forma estável na leitura', () => {
    const [a, b] = makeTitles(2) as [string, string];
    const list = createList(db, { name: 'L', description: null });
    db.exec('PRAGMA foreign_keys = OFF;');
    db.query(`INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, 5, '2026-01-02')`).run(list.id, b);
    db.query(`INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, 5, '2026-01-01')`).run(list.id, a);
    db.exec('PRAGMA foreign_keys = ON;');
    expect(orderOf(list.id)).toEqual([a, b]);
  });
});

describe('listas: exclusão em cascata', () => {
  test('apagar a lista apaga os itens e não apaga os títulos', () => {
    const [a] = makeTitles(1) as [string];
    const list = createList(db, { name: 'L', description: null });
    addTitlesToList(db, list.id, [a]);
    expect(deleteList(db, list.id)).toBe(true);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM list_items').get()?.n).toBe(0);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n).toBe(1);
  });

  test('apagar o título remove o item de todas as listas', () => {
    const [a, b] = makeTitles(2) as [string, string];
    const l1 = createList(db, { name: 'L1', description: null });
    const l2 = createList(db, { name: 'L2', description: null });
    addTitlesToList(db, l1.id, [a, b]);
    addTitlesToList(db, l2.id, [a]);
    db.query('DELETE FROM titles WHERE id = ?').run(a);
    expect(orderOf(l1.id)).toEqual([b]);
    expect(orderOf(l2.id)).toEqual([]);
  });
});

describe('listas: leitura paginada e capas', () => {
  test('resumo traz contagem, capas (primeiros pôsteres) e se contém um título', () => {
    const ids = makeTitles(6);
    const list = createList(db, { name: 'L', description: null });
    addTitlesToList(db, list.id, ids);
    const [summary] = listSummaries(db, { limit: 10, offset: 0, containsTitleId: ids[5] ?? null }).items;
    expect(summary?.itemCount).toBe(6);
    expect(summary?.covers).toHaveLength(4);
    expect(summary?.containsTitle).toBe(true);
  });

  test('pagina a lista de listas e o detalhe; offset além do fim devolve vazio com o total', () => {
    for (let i = 0; i < 5; i++) createList(db, { name: `L${i}`, description: null });
    const page = listSummaries(db, { limit: 2, offset: 4, containsTitleId: null });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(1);
    expect(listSummaries(db, { limit: 2, offset: 50, containsTitleId: null }).items).toEqual([]);
  });

  test('nomes das listas por título (para a coluna do CSV), ordenados pelo nome', () => {
    const [a] = makeTitles(1) as [string];
    const z = createList(db, { name: 'Zeta', description: null });
    const y = createList(db, { name: 'alfa', description: null });
    addTitlesToList(db, z.id, [a]);
    addTitlesToList(db, y.id, [a]);
    expect(listNamesByTitle(db).get(a)).toEqual(['alfa', 'Zeta']);
  });
});
