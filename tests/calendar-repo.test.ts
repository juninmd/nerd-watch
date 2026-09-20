import { beforeEach, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { listUpcoming } from '../src/server/repo/calendar.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

const FROM = '2026-09-20';
const addDays = (days: number): string => {
  const d = new Date(`${FROM}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  db = openDb(':memory:');
});

test('só traz episódios de títulos que estão na biblioteca', () => {
  const tracked = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'tv', title: 'Rastreado' });
  const untracked = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'tv', title: 'Não rastreado' });
  upsertLibraryEntry(db, tracked.id, { watchStatus: 'watching' });

  for (const title of [tracked, untracked]) {
    const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
    replaceEpisodes(db, season.id, [{ episodeNumber: 1, name: 'Ep 1', airDate: addDays(5) }]);
  }

  const entries = listUpcoming(db, 30, FROM);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.titleName).toBe('Rastreado');
});

test('ignora episódios fora da janela de dias', () => {
  const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'tv', title: 'Série' });
  upsertLibraryEntry(db, title.id, { watchStatus: 'watching' });
  const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, season.id, [
    { episodeNumber: 1, name: 'Dentro', airDate: addDays(10) },
    { episodeNumber: 2, name: 'Fora', airDate: addDays(90) },
  ]);

  const entries = listUpcoming(db, 30, FROM);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.episodeName).toBe('Dentro');
});

test('inclui filmes rastreados com release_date futuro, ordenados por data', () => {
  const movie = upsertTitle(db, { source: 'tmdb', sourceId: '9', mediaType: 'movie', title: 'Filme', releaseDate: addDays(20) });
  upsertLibraryEntry(db, movie.id, { watchStatus: 'want' });

  const series = upsertTitle(db, { source: 'tmdb', sourceId: '8', mediaType: 'tv', title: 'Série' });
  upsertLibraryEntry(db, series.id, { watchStatus: 'watching' });
  const season = upsertSeason(db, series.id, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, season.id, [{ episodeNumber: 1, name: 'Ep', airDate: addDays(3) }]);

  const entries = listUpcoming(db, 30, FROM);
  expect(entries.map((e) => e.kind)).toEqual(['episode', 'movie']);
});
