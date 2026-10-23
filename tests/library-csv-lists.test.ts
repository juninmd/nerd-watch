import { describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { exportLibraryCsv, parseLibraryCsv } from '../src/server/providers/library-io/library-csv.ts';
import { parseCsv } from '../src/server/providers/library-io/csv.ts';
import { upsertLibraryEntry, listLibrary } from '../src/server/repo/library.ts';
import { addTitlesToList, createList, listNamesByTitle } from '../src/server/repo/lists.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

const setup = (): { db: Database; movieId: string; loneId: string } => {
  const db = openDb(':memory:');
  const movie = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
  upsertLibraryEntry(db, movie.id, { watchStatus: 'want' });
  const lone = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'movie', title: 'Sozinho' });
  upsertLibraryEntry(db, lone.id, { watchStatus: 'want' });
  return { db, movieId: movie.id, loneId: lone.id };
};

const exportWithLists = (db: Database): string => exportLibraryCsv(listLibrary(db), listNamesByTitle(db));
const rowFor = (csv: string, title: string): string[] | undefined =>
  parseCsv(csv)
    .map((r) => r.cells)
    .find((cells) => cells[0] === title);

describe('exportação CSV: coluna lists', () => {
  test('o cabeçalho termina com "lists" e títulos sem lista deixam a célula vazia', () => {
    const { db } = setup();
    const csv = exportWithLists(db);
    expect(parseCsv(csv)[0]?.cells.at(-1)).toBe('lists');
    expect(rowFor(csv, 'Sozinho')?.at(-1)).toBe('');
  });

  test('lista os nomes das listas do título separados por " | ", em ordem alfabética', () => {
    const { db, movieId } = setup();
    const z = createList(db, { name: 'Zeta', description: null });
    const a = createList(db, { name: 'alfa', description: null });
    addTitlesToList(db, z.id, [movieId]);
    addTitlesToList(db, a.id, [movieId]);
    expect(rowFor(exportWithLists(db), 'Filme')?.at(-1)).toBe('alfa | Zeta');
  });

  test('nome de lista com vírgula e aspas sai entre aspas e volta igual', () => {
    const { db, movieId } = setup();
    const list = createList(db, { name: 'Ação, "clássicos"', description: null });
    addTitlesToList(db, list.id, [movieId]);
    expect(rowFor(exportWithLists(db), 'Filme')?.at(-1)).toBe('Ação, "clássicos"');
  });

  test('nome de lista que parece fórmula é neutralizado, como as demais células', () => {
    const { db, movieId } = setup();
    const list = createList(db, { name: '=HYPERLINK("http://exemplo.test")', description: null });
    addTitlesToList(db, list.id, [movieId]);
    const cell = rowFor(exportWithLists(db), 'Filme')?.at(-1) ?? '';
    expect(cell.startsWith("'=")).toBe(true);
    expect(cell.startsWith('=')).toBe(false);
  });

  test('o arquivo com a coluna nova continua importando sem erro de linha (a coluna é ignorada na importação)', () => {
    const { db, movieId } = setup();
    const list = createList(db, { name: 'Noite', description: null });
    addTitlesToList(db, list.id, [movieId]);
    const report = parseLibraryCsv(exportWithLists(db));
    expect(report.errors).toEqual([]);
    expect(report.rows.map((r) => r.title).sort()).toEqual(['Filme', 'Sozinho']);
  });

  test('exportar sem o mapa de listas continua funcionando (coluna vazia)', () => {
    const { db } = setup();
    expect(rowFor(exportLibraryCsv(listLibrary(db)), 'Filme')?.at(-1)).toBe('');
  });
});
