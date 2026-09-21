import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { getSeasonsWithEpisodes, replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('getSeasonsWithEpisodes', () => {
  test('agrupa os episódios na temporada correta, sem misturar entre temporadas (regressão do fix de N+1)', () => {
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'tv', title: 'Série Teste' });
    const season1 = upsertSeason(db, title.id, { seasonNumber: 1, name: 'Temporada 1' });
    const season2 = upsertSeason(db, title.id, { seasonNumber: 2, name: 'Temporada 2' });
    replaceEpisodes(db, season1.id, [{ episodeNumber: 1, name: 'S1E1' }, { episodeNumber: 2, name: 'S1E2' }]);
    replaceEpisodes(db, season2.id, [{ episodeNumber: 1, name: 'S2E1' }]);

    const result = getSeasonsWithEpisodes(db, title.id);

    expect(result).toHaveLength(2);
    expect(result[0]?.episodes.map((e) => e.name)).toEqual(['S1E1', 'S1E2']);
    expect(result[1]?.episodes.map((e) => e.name)).toEqual(['S2E1']);
  });

  test('temporada sem episódios devolve lista vazia, não undefined', () => {
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'tv', title: 'Série Sem Episódios' });
    upsertSeason(db, title.id, { seasonNumber: 1, name: 'Temporada 1' });

    const result = getSeasonsWithEpisodes(db, title.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.episodes).toEqual([]);
  });

  test('título sem temporadas devolve lista vazia', () => {
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '3', mediaType: 'tv', title: 'Sem Temporadas' });
    expect(getSeasonsWithEpisodes(db, title.id)).toEqual([]);
  });
});
