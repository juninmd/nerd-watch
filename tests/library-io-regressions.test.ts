import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { parseCsv } from '../src/server/providers/library-io/csv.ts';
import { InputError } from '../src/server/providers/library-io/common.ts';
import { importLibraryCsv } from '../src/server/providers/library-io/import-csv.ts';
import { importMalAnimeList } from '../src/server/providers/library-io/import-mal.ts';
import { listLibrary, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

/** Regressões achadas na revisão: cada teste fixa um caso que antes estava errado. */

describe('colunas opcionais ausentes não apagam dados', () => {
  test('arquivo só com title,type,status,tmdb_id não zera nota, notas nem progresso existentes', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '500', mediaType: 'tv', title: 'Série' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching', rating: 9, notes: 'guardada', currentSeason: 1, currentEpisode: 3 });

    const report = importLibraryCsv(db, 'title,type,status,tmdb_id\r\nSérie,tv,watched,500');

    expect(report.updated).toBe(1);
    const [item] = listLibrary(db);
    expect(item?.watch_status).toBe('watched');
    expect(item?.rating).toBe(9);
    expect(item?.notes).toBe('guardada');
    expect(item?.current_season).toBe(1);
    expect(item?.current_episode).toBe(3);
  });

  test('coluna presente com célula vazia continua limpando o valor (é diferente de coluna ausente)', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '501', mediaType: 'movie', title: 'Filme' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'want', rating: 7 });
    importLibraryCsv(db, 'title,type,status,rating,tmdb_id\r\nFilme,movie,want,,501');
    expect(listLibrary(db)[0]?.rating).toBeNull();
  });

  test('reimportar um arquivo parcial não conta mudança quando só o status já é o mesmo', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '502', mediaType: 'movie', title: 'Filme' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched', rating: 4 });
    const report = importLibraryCsv(db, 'title,type,status,tmdb_id\r\nFilme,movie,watched,502');
    expect(report.unchanged).toBe(1);
  });
});

describe('casamento sem ano', () => {
  test('linha sem coluna year casa com o título da biblioteca que tem ano', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'archive', sourceId: 'a-1', mediaType: 'movie', title: 'Filme Antigo', releaseDate: '1950-01-01' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });

    const report = importLibraryCsv(db, 'title,type,status\r\nFilme Antigo,movie,watched');

    expect(report.errors).toEqual([]);
    expect(report.updated).toBe(1);
    expect(listLibrary(db)[0]?.watch_status).toBe('watched');
  });

  test('ano informado que não bate com o da biblioteca continua sem casar', () => {
    const db = openDb(':memory:');
    const t = upsertTitle(db, { source: 'archive', sourceId: 'a-2', mediaType: 'movie', title: 'Filme Antigo', releaseDate: '1950-01-01' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    const report = importLibraryCsv(db, 'title,year,type,status\r\nFilme Antigo,1999,movie,watched');
    expect(report.errors).toHaveLength(1);
  });
});

describe('formato do arquivo', () => {
  test('separador ponto e vírgula (Excel em pt-BR) é 400 com a causa, não "faltam colunas"', () => {
    const db = openDb(':memory:');
    let thrown: unknown;
    try {
      importLibraryCsv(db, 'title;year;type;status\r\nFilme;2001;movie;want');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InputError);
    expect((thrown as Error).message).toContain('vírgula');
  });

  test('linhas só com vírgulas ou espaços são ignoradas, sem virar erro', () => {
    const db = openDb(':memory:');
    const report = importLibraryCsv(db, 'title,type,status,tmdb_id\r\n,,,\r\n   \r\nFilme,movie,want,600');
    expect(report.errors).toEqual([]);
    expect(report.imported).toBe(1);
  });

  test('CR sozinho termina registro (arquivo de Mac antigo) e não entra na última célula', () => {
    expect(parseCsv('a,b\r1,2\r').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('MyAnimeList com lista grande', () => {
  test('5000 entradas com 10 campos cada (acima do teto antigo de nós) são lidas', () => {
    const entry = (i: number) =>
      `<anime><series_animedb_id>${i + 1}</series_animedb_id><series_title>Anime ${i}</series_title><series_type>1</series_type>` +
      `<series_episodes>12</series_episodes><my_id>0</my_id><my_watched_episodes>12</my_watched_episodes>` +
      `<my_start_date>0000-00-00</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_rated>0</my_rated>` +
      `<my_score>7</my_score><my_status>Completed</my_status></anime>`;
    const xml = `<myanimelist>${Array.from({ length: 5000 }, (_, i) => entry(i)).join('')}</myanimelist>`;
    const report = importMalAnimeList(openDb(':memory:'), xml);
    expect(report.entries).toBe(5000);
    expect(report.unresolved).toHaveLength(5000);
  });
});
