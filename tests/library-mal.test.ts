import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { InputError, MAL_MAX_ENTRIES } from '../src/server/providers/library-io/common.ts';
import { importMalAnimeList } from '../src/server/providers/library-io/import-mal.ts';
import { parseMalAnimeList } from '../src/server/providers/library-io/mal-xml.ts';
import type { TitleRow } from '../src/server/types.ts';
import { listLibrary, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

/** Exportação sintética no formato documentado do MyAnimeList (animelist), com nomes fictícios. */
const entry = (fields: Record<string, string>): string =>
  `<anime>${Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('')}</anime>`;

const doc = (...entries: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8" ?>\n<myanimelist>\n<myinfo><user_id>1</user_id><user_name>exemplo</user_name></myinfo>\n${entries.join('\n')}\n</myanimelist>`;

const ALPHA = entry({
  series_animedb_id: '1001',
  series_title: '<![CDATA[Anime Fictício Alfa]]>',
  my_watched_episodes: '12',
  my_status: 'Completed',
  my_score: '8',
});
const BETA = entry({ series_animedb_id: '1002', series_title: 'Anime Fictício Beta', my_status: 'Plan to Watch', my_score: '0' });
const GAMA = entry({ series_animedb_id: '1003', series_title: 'Anime Fictício Gama', my_status: 'On-Hold', my_score: '5' });

const HAPPY = doc(ALPHA, BETA, GAMA);

const resolverFor =
  (map: Record<number, TitleRow>) =>
  (malId: number): TitleRow | null =>
    map[malId] ?? null;

describe('parseMalAnimeList: mapeamento documentado', () => {
  test('happy path: status, nota e id saem certos; nota 0 vira "sem nota"', () => {
    const { entries, errors } = parseMalAnimeList(HAPPY);
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { row: 1, malId: 1001, title: 'Anime Fictício Alfa', watchStatus: 'watched', rating: 8 },
      { row: 2, malId: 1002, title: 'Anime Fictício Beta', watchStatus: 'want', rating: null },
      { row: 3, malId: 1003, title: 'Anime Fictício Gama', watchStatus: 'watching', rating: 5 },
    ]);
  });

  test('status é comparado sem diferença de caixa e Dropped vira dropped', () => {
    const { entries } = parseMalAnimeList(doc(entry({ series_animedb_id: '7', my_status: 'completed' }), entry({ series_animedb_id: '8', my_status: 'DROPPED' })));
    expect(entries.map((e) => e.watchStatus)).toEqual(['watched', 'dropped']);
  });

  test('série sem series_title entra com título vazio (o relatório usa o id)', () => {
    const { entries } = parseMalAnimeList(doc(entry({ series_animedb_id: '9', my_status: 'Watching' })));
    expect(entries).toEqual([{ row: 1, malId: 9, title: '', watchStatus: 'watching', rating: null }]);
  });

  test('o id do MAL é o único identificador: nada é inferido do título', () => {
    const { entries } = parseMalAnimeList(doc(entry({ series_animedb_id: '4242', series_title: 'Outro Nome', my_status: 'Completed' })));
    expect(entries[0]?.malId).toBe(4242);
  });
});

describe('parseMalAnimeList: campos ausentes e inválidos viram erro por entrada', () => {
  test('sem series_animedb_id: a entrada é recusada, as outras entram', () => {
    const { entries, errors } = parseMalAnimeList(doc(entry({ series_title: 'Sem Id', my_status: 'Completed' }), ALPHA));
    expect(entries.map((e) => e.malId)).toEqual([1001]);
    expect(errors).toEqual([{ row: 1, message: expect.stringContaining('series_animedb_id') }]);
  });

  test('id não numérico ou zero é erro', () => {
    const { errors } = parseMalAnimeList(doc(entry({ series_animedb_id: 'abc', my_status: 'Completed' }), entry({ series_animedb_id: '0', my_status: 'Completed' })));
    expect(errors.map((e) => e.row)).toEqual([1, 2]);
  });

  test('sem my_status é erro (não há status padrão inventado)', () => {
    const { entries, errors } = parseMalAnimeList(doc(entry({ series_animedb_id: '5', series_title: 'Sem Status' })));
    expect(entries).toEqual([]);
    expect(errors).toEqual([{ row: 1, message: expect.stringContaining('my_status') }]);
  });

  test('status desconhecido (inclusive o código numérico antigo) é erro', () => {
    const { errors } = parseMalAnimeList(doc(entry({ series_animedb_id: '6', my_status: 'Rewatching' }), entry({ series_animedb_id: '7', my_status: '2' })));
    expect(errors.map((e) => e.row)).toEqual([1, 2]);
  });

  test('nota fora de 0-10 ou não inteira é erro', () => {
    const { errors } = parseMalAnimeList(
      doc(
        entry({ series_animedb_id: '1', my_status: 'Completed', my_score: '11' }),
        entry({ series_animedb_id: '2', my_status: 'Completed', my_score: 'dez' }),
        entry({ series_animedb_id: '3', my_status: 'Completed', my_score: '7.5' }),
      ),
    );
    expect(errors.map((e) => e.row)).toEqual([1, 2, 3]);
  });

  test('nota ausente é "sem nota", não erro', () => {
    const { entries, errors } = parseMalAnimeList(doc(entry({ series_animedb_id: '1', my_status: 'Completed' })));
    expect(errors).toEqual([]);
    expect(entries[0]?.rating).toBeNull();
  });
});

describe('parseMalAnimeList: entrada hostil e malformada (rejeitada antes de qualquer leitura)', () => {
  test('recusa DOCTYPE (XXE e billion laughs começam aqui)', () => {
    const xxe = `<?xml version="1.0"?>\n<!DOCTYPE myanimelist [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n<myanimelist>${ALPHA}</myanimelist>`;
    expect(() => parseMalAnimeList(xxe)).toThrow(InputError);
    try {
      parseMalAnimeList(xxe);
    } catch (err) {
      expect((err as InputError).status).toBe(400);
      expect((err as Error).message).toContain('DOCTYPE');
    }
  });

  test('recusa ENTITY declarada solta e uso de entidade externa', () => {
    expect(() => parseMalAnimeList(`<!ENTITY a "b"><myanimelist>${ALPHA}</myanimelist>`)).toThrow(InputError);
    expect(() => parseMalAnimeList(`<myanimelist>${entry({ series_animedb_id: '1', my_status: '&xxe;' })}</myanimelist>`)).not.toThrow();
  });

  test('XML malformado é 400, não erro interno', () => {
    expect(() => parseMalAnimeList('<myanimelist><anime>')).toThrow(InputError);
    expect(() => parseMalAnimeList('')).toThrow(InputError);
  });

  test('raiz que não é myanimelist é 400', () => {
    expect(() => parseMalAnimeList(`<outra>${ALPHA}</outra>`)).toThrow(InputError);
  });

  test(`mais de ${MAL_MAX_ENTRIES} entradas são recusadas`, () => {
    const many = Array.from({ length: MAL_MAX_ENTRIES + 1 }, (_, i) => entry({ series_animedb_id: String(i + 1), my_status: 'Completed' }));
    expect(() => parseMalAnimeList(doc(...many))).toThrow(InputError);
  });
});

describe('importMalAnimeList: identidade offline', () => {
  test('sem correspondência offline, nada é gravado e todas as entradas vão para "sem correspondência"', () => {
    const db = openDb(':memory:');
    const report = importMalAnimeList(db, HAPPY);
    expect(report).toMatchObject({ entries: 3, imported: 0, updated: 0, unchanged: 0 });
    expect(report.unresolved.map((u) => u.malId)).toEqual([1001, 1002, 1003]);
    expect(listLibrary(db)).toEqual([]);
  });

  test('com uma correspondência (resolvedor injetado), grava status e nota e reporta o resto', () => {
    const db = openDb(':memory:');
    const alpha = upsertTitle(db, { source: 'anilist', sourceId: '777', mediaType: 'tv', title: 'Anime Fictício Alfa' });
    const report = importMalAnimeList(db, HAPPY, resolverFor({ 1001: alpha }));
    expect(report.imported).toBe(1);
    expect(report.unresolved.map((u) => u.malId)).toEqual([1002, 1003]);
    const [item] = listLibrary(db);
    expect(item?.title_id).toBe(alpha.id);
    expect(item?.watch_status).toBe('watched');
    expect(item?.rating).toBe(8);
  });

  test('reimportar com a mesma correspondência não duplica e conta unchanged', () => {
    const db: Database = openDb(':memory:');
    const alpha = upsertTitle(db, { source: 'anilist', sourceId: '777', mediaType: 'tv', title: 'Anime Fictício Alfa' });
    const resolver = resolverFor({ 1001: alpha });
    importMalAnimeList(db, HAPPY, resolver);
    const again = importMalAnimeList(db, HAPPY, resolver);
    expect(again).toMatchObject({ imported: 0, updated: 0, unchanged: 1 });
    expect(listLibrary(db)).toHaveLength(1);
  });

  test('entrada resolvida que já estava na lista com outro status é atualizada', () => {
    const db = openDb(':memory:');
    const alpha = upsertTitle(db, { source: 'anilist', sourceId: '777', mediaType: 'tv', title: 'Anime Fictício Alfa' });
    upsertLibraryEntry(db, alpha.id, { watchStatus: 'want' });
    const report = importMalAnimeList(db, HAPPY, resolverFor({ 1001: alpha }));
    expect(report.updated).toBe(1);
    expect(listLibrary(db)[0]?.watch_status).toBe('watched');
  });
});
