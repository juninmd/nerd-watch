import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { parseCsv, toCsv } from '../src/server/providers/library-io/csv.ts';
import { CSV_MAX_ROWS, InputError } from '../src/server/providers/library-io/common.ts';
import { exportLibraryCsv, LIBRARY_CSV_COLUMNS, parseLibraryCsv } from '../src/server/providers/library-io/library-csv.ts';
import { importLibraryCsv } from '../src/server/providers/library-io/import-csv.ts';
import { listLibrary, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const HEADER = 'title,year,type,status,rating,current_season,current_episode,notes,tmdb_id,added_at';

/** Biblioteca sintética com os casos difíceis: unicode, vírgula, aspas, quebra de linha e fórmulas. */
const seedLibrary = (db: Database): void => {
  const a = upsertTitle(db, { source: 'tmdb', sourceId: '101', mediaType: 'movie', title: 'Ação, "aspas" e 🎬' });
  upsertLibraryEntry(db, a.id, { watchStatus: 'watched', rating: 9, notes: 'linha 1\r\nlinha 2, com vírgula' });
  const b = upsertTitle(db, { source: 'tmdb', sourceId: '202', mediaType: 'tv', title: 'Série 日本語' });
  upsertLibraryEntry(db, b.id, { watchStatus: 'watching', currentSeason: 2, currentEpisode: 5 });
  const c = upsertTitle(db, { source: 'tmdb', sourceId: '303', mediaType: 'movie', title: '=HYPERLINK("http://exemplo.test","x")' });
  upsertLibraryEntry(db, c.id, { watchStatus: 'want', notes: '@SUM(1+1)' });
  const d = upsertTitle(db, { source: 'archive', sourceId: 'arq-1', mediaType: 'movie', title: '-cmd\tcom tab' });
  upsertLibraryEntry(db, d.id, { watchStatus: 'dropped', notes: '+1\r(CR)' });
};

const exportFrom = (db: Database): string => exportLibraryCsv(listLibrary(db));

/** Linhas de dados (sem cabeçalho) de um CSV exportado. */
const dataRows = (csv: string): string[][] => parseCsv(csv).slice(1).map((r) => r.cells);

/** Mantém só o cabeçalho e as linhas com tmdb_id: as de outras origens não têm identidade para reimportar. */
const tmdbOnly = (csv: string): string => {
  const [header, ...rows] = parseCsv(csv).map((r) => r.cells);
  return toCsv([header ?? [], ...rows.filter((r) => r[8] !== '')]);
};

const titleCount = (db: Database): number => db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n ?? 0;

describe('exportLibraryCsv: formato', () => {
  test('cabeçalho com as colunas pedidas e BOM no início', () => {
    expect(exportLibraryCsv([])).toBe(`﻿${LIBRARY_CSV_COLUMNS.join(',')}\r\n`);
    // A importação aceita o cabeçalho antigo (sem "lists"); a exportação acrescenta a coluna no fim.
    expect(LIBRARY_CSV_COLUMNS.join(',')).toBe(`${HEADER},lists`);
  });

  test('tmdb_id só sai para títulos da TMDB; outras origens ficam vazias', () => {
    const db = openDb(':memory:');
    seedLibrary(db);
    const ids = dataRows(exportFrom(db)).map((r) => r[8]);
    expect(ids.sort()).toEqual(['', '101', '202', '303']);
  });

  test('ano sai do release_date e tipo/status saem com os valores do banco', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '7', mediaType: 'tv', title: 'X', releaseDate: '1999-03-04' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    expect(dataRows(exportFrom(db))[0]?.slice(1, 4)).toEqual(['1999', 'tv', 'watching']);
  });
});

describe('exportLibraryCsv: injeção de fórmula', () => {
  test('nenhuma célula exportada começa com = + - @ tab ou CR', () => {
    const db = openDb(':memory:');
    seedLibrary(db);
    const rows = dataRows(exportFrom(db));
    expect(rows).toHaveLength(4);
    for (const row of rows) for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });

  test('a célula perigosa ganha apóstrofo inicial, inclusive a nota', () => {
    const db = openDb(':memory:');
    seedLibrary(db);
    const rows = dataRows(exportFrom(db));
    expect(rows.find((r) => r[0] === `'=HYPERLINK("http://exemplo.test","x")`)?.[7]).toBe("'@SUM(1+1)");
    expect(rows.some((r) => r[0] === "'-cmd\tcom tab")).toBe(true);
  });
});

describe('importLibraryCsv: ida e volta', () => {
  test('exportar, importar num banco vazio e exportar de novo reproduz tudo, exceto added_at', () => {
    const source = openDb(':memory:');
    seedLibrary(source);
    const csv = tmdbOnly(exportFrom(source));

    const target = openDb(':memory:');
    const report = importLibraryCsv(target, csv);
    expect(report.errors).toEqual([]);
    expect(report.imported).toBe(3);

    // listLibrary ordena por updated_at: compara as linhas ordenadas, não a ordem de saída.
    const withoutAddedAt = (text: string) => dataRows(text).map((r) => r.slice(0, 9).join('\u0001')).sort();
    expect(withoutAddedAt(exportFrom(target))).toEqual(withoutAddedAt(csv));
  });

  test('título com unicode, vírgula, aspas, quebra de linha e fórmula volta idêntico', () => {
    const source = openDb(':memory:');
    seedLibrary(source);
    const target = openDb(':memory:');
    importLibraryCsv(target, exportFrom(source));
    const items = listLibrary(target);
    expect(items.map((i) => i.title.title).sort()).toEqual(['=HYPERLINK("http://exemplo.test","x")', 'Ação, "aspas" e 🎬', 'Série 日本語'].sort());
    expect(items.find((i) => i.title.title === 'Ação, "aspas" e 🎬')?.notes).toBe('linha 1\r\nlinha 2, com vírgula');
    expect(items.find((i) => i.title.title === '=HYPERLINK("http://exemplo.test","x")')?.notes).toBe('@SUM(1+1)');
  });

  test('linha de outra origem (sem tmdb_id) não entra num banco vazio e aparece como erro', () => {
    const source = openDb(':memory:');
    seedLibrary(source);
    const target = openDb(':memory:');
    const report = importLibraryCsv(target, exportFrom(source));
    expect(report.imported).toBe(3);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toContain('tmdb_id');
  });
});

describe('importLibraryCsv: validação por linha', () => {
  test('linha com número errado de colunas vira erro e as outras entram', () => {
    const db = openDb(':memory:');
    const csv = `${HEADER}\r\nFilme A,2001,movie,want,,,,,101,\r\nFilme B,2001,movie\r\nFilme C,2002,movie,want,,,,,102,`;
    const report = importLibraryCsv(db, csv);
    expect(report.imported).toBe(2);
    expect(report.errors).toEqual([{ row: 3, message: expect.stringContaining('colunas') }]);
  });

  test('valores inválidos viram erro com o número da linha, sem derrubar o arquivo', () => {
    const db = openDb(':memory:');
    const lines = [
      HEADER,
      'Bom,,movie,watched,7,,,,1,',
      'Tipo errado,,film,want,,,,,2,',
      'Status errado,,movie,rewatching,,,,,3,',
      'Nota 11,,movie,want,11,,,,4,',
      'Nota quebrada,,movie,want,8.5,,,,5,',
      ',,movie,want,,,,,6,',
      'Ano feio,20x1,movie,want,,,,,7,',
      'Temporada negativa,,tv,watching,,-1,,,8,',
      'Id ruim,,movie,want,,,,,abc,',
      'Id zero,,movie,want,,,,,0,',
    ];
    const report = importLibraryCsv(db, lines.join('\r\n'));
    expect(report.imported).toBe(1);
    expect(report.errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test('cabeçalho sem coluna obrigatória é erro do arquivo inteiro (400)', () => {
    const db = openDb(':memory:');
    let thrown: unknown;
    try {
      importLibraryCsv(db, 'title,type\r\nX,movie');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InputError);
    expect((thrown as InputError).status).toBe(400);
    expect((thrown as Error).message).toContain('status');
  });

  test('aspa sem fechamento é erro 400', () => {
    const db = openDb(':memory:');
    expect(() => importLibraryCsv(db, `${HEADER}\r\n"Filme sem fim,2001,movie,want`)).toThrow(InputError);
  });

  test('título vazio e título longo demais são recusados por linha', () => {
    const db = openDb(':memory:');
    const long = 'x'.repeat(301);
    const report = importLibraryCsv(db, `${HEADER}\r\n   ,,movie,want,,,,,1,\r\n${long},,movie,want,,,,,2,`);
    expect(report.errors.map((e) => e.row)).toEqual([2, 3]);
  });

  test('o mesmo título duas vezes no arquivo: a segunda linha é erro, não sobrescrita silenciosa', () => {
    const db = openDb(':memory:');
    const report = importLibraryCsv(db, `${HEADER}\r\nFilme,,movie,want,,,,,9,\r\nFilme,,movie,watched,,,,,9,`);
    expect(report.imported).toBe(1);
    expect(report.errors).toEqual([{ row: 3, message: expect.stringContaining('duplicada') }]);
  });

  test('tmdb_id que já é série não vira filme (colisão de tipo é erro)', () => {
    const db = openDb(':memory:');
    upsertTitle(db, { source: 'tmdb', sourceId: '55', mediaType: 'tv', title: 'Série' });
    const report = importLibraryCsv(db, `${HEADER}\r\nFilme,,movie,want,,,,,55,`);
    expect(report.imported).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(titleCount(db)).toBe(1);
  });

  test('linha sem tmdb_id e sem título correspondente na biblioteca é erro: nunca inventa identidade', () => {
    const db = openDb(':memory:');
    const report = importLibraryCsv(db, `${HEADER}\r\nSem Id,2010,movie,want,,,,,,`);
    expect(report.errors).toEqual([{ row: 2, message: expect.stringContaining('tmdb_id') }]);
    expect(titleCount(db)).toBe(0);
  });

  test('sem tmdb_id, casa por título+tipo+ano com o que já está na biblioteca (sem diferença de caixa ou espaço)', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'archive', sourceId: 'arq-9', mediaType: 'movie', title: 'Filme Local', releaseDate: '1950-01-01' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    const report = importLibraryCsv(db, `${HEADER}\r\n  filme local ,1950,movie,watched,,,,,,`);
    expect(report.errors).toEqual([]);
    expect(report.updated).toBe(1);
    expect(listLibrary(db)[0]?.watch_status).toBe('watched');
  });

  test('sem tmdb_id e nome ambíguo (dois títulos iguais) é erro, não escolhe um', () => {
    const db = openDb(':memory:');
    for (const id of ['a1', 'a2']) {
      const t = upsertTitle(db, { source: 'archive', sourceId: id, mediaType: 'movie', title: 'Mesmo Nome' });
      upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    }
    const report = importLibraryCsv(db, `${HEADER}\r\nMesmo Nome,,movie,watched,,,,,,`);
    expect(report.updated).toBe(0);
    expect(report.errors).toEqual([{ row: 2, message: expect.stringContaining('ambíguo') }]);
  });
});

describe('importLibraryCsv: idempotência', () => {
  test('importar duas vezes o mesmo arquivo não duplica títulos nem entradas', () => {
    const source = openDb(':memory:');
    seedLibrary(source);
    const csv = tmdbOnly(exportFrom(source));

    const target = openDb(':memory:');
    importLibraryCsv(target, csv);
    const second = importLibraryCsv(target, csv);

    expect(second).toMatchObject({ imported: 0, updated: 0, unchanged: 3, failed: 0 });
    expect(listLibrary(target)).toHaveLength(3);
    expect(titleCount(target)).toBe(3);
  });

  test('reimportar com um status mudado atualiza a entrada existente, sem duplicar', () => {
    const db = openDb(':memory:');
    importLibraryCsv(db, `${HEADER}\r\nFilme,2001,movie,want,,,,,77,`);
    const again = importLibraryCsv(db, `${HEADER}\r\nFilme,2001,movie,watched,8,,,,77,`);
    expect(again).toMatchObject({ imported: 0, updated: 1, unchanged: 0, failed: 0 });
    const items = listLibrary(db);
    expect(items).toHaveLength(1);
    expect(items[0]?.watch_status).toBe('watched');
    expect(items[0]?.rating).toBe(8);
  });

  test('linha idêntica à que já está gravada conta como unchanged', () => {
    const db = openDb(':memory:');
    const csv = `${HEADER}\r\nFilme,,movie,watching,,2,3,,88,`;
    importLibraryCsv(db, csv);
    const again = importLibraryCsv(db, csv);
    expect(again.updated).toBe(0);
    expect(again.unchanged).toBe(1);
  });
});

describe('limites de linhas', () => {
  const rowsOf = (n: number): string[] => Array.from({ length: n }, (_, i) => `Filme ${i},,movie,want,,,,,${i + 1},`);

  test(`mais de ${CSV_MAX_ROWS} linhas de dados são recusadas com 400, antes de gravar qualquer coisa`, () => {
    const db = openDb(':memory:');
    expect(() => importLibraryCsv(db, [HEADER, ...rowsOf(CSV_MAX_ROWS + 1)].join('\r\n'))).toThrow(InputError);
    expect(listLibrary(db)).toEqual([]);
  });

  test('exatamente o limite de linhas passa', () => {
    const db = openDb(':memory:');
    expect(importLibraryCsv(db, [HEADER, ...rowsOf(CSV_MAX_ROWS)].join('\r\n')).imported).toBe(CSV_MAX_ROWS);
  });

  test('o leitor sozinho também aplica o teto', () => {
    expect(() => parseLibraryCsv([HEADER, ...rowsOf(CSV_MAX_ROWS + 1)].join('\n'))).toThrow(InputError);
  });
});
