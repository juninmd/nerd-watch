import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { loadStatsInputs } from '../src/server/repo/stats.ts';
import { replaceEpisodes, setCatalogStats, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

const event = (titleId: string, kind: string, at: string): void => {
  db.query('INSERT INTO library_history (id, title_id, kind, at, detail) VALUES (?, ?, ?, ?, NULL)').run(crypto.randomUUID(), titleId, kind, at);
};

describe('loadStatsInputs', () => {
  test('banco vazio: tudo zerado', () => {
    const i = loadStatsInputs(db, 2026);
    expect(i.firstEventAt).toBeNull();
    expect(i.watched).toEqual([]);
    expect(i.wanted).toEqual([]);
    expect(i.periodEvents).toEqual([]);
    expect(i.periodTitles.size).toBe(0);
  });

  test('filme usa runtime; série soma episódios conhecidos e conta os sem duração', () => {
    const movie = upsertTitle(db, { source: 'tmdb', sourceId: 'm', mediaType: 'movie', title: 'F' });
    setCatalogStats(db, movie.id, { genres: ['Drama'], runtimeMinutes: 100 });
    upsertLibraryEntry(db, movie.id, { watchStatus: 'watched', rating: 8 });

    const show = upsertTitle(db, { source: 'tmdb', sourceId: 's', mediaType: 'tv', title: 'S' });
    const season = upsertSeason(db, show.id, { seasonNumber: 1, name: 'T1' });
    replaceEpisodes(db, season.id, [
      { episodeNumber: 1, name: 'a', runtime: 40 },
      { episodeNumber: 2, name: 'b', runtime: 50 },
      { episodeNumber: 3, name: 'c' },
    ]);
    upsertLibraryEntry(db, show.id, { watchStatus: 'want' });

    const i = loadStatsInputs(db, 2026);
    expect(i.statusCounts).toEqual({ watched: 1, want: 1 });
    expect(i.watched).toEqual([{ minutes: 100, episodesWithoutRuntime: 0 }]);
    expect(i.wanted).toEqual([{ minutes: 90, episodesWithoutRuntime: 1 }]);
  });

  test('eventos do ano trazem gêneros, nota e duração; eventos de outro ano ficam de fora', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: 'x', mediaType: 'movie', title: 'X' });
    setCatalogStats(db, t.id, { genres: ['Ação'], runtimeMinutes: 90 });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched', rating: 9 });
    db.exec('DELETE FROM library_history');
    event(t.id, 'finished', '2026-03-10T12:00:00Z');
    event(t.id, 'finished', '2024-03-10T12:00:00Z');

    const i = loadStatsInputs(db, 2026);
    expect(i.firstEventAt).toBe('2024-03-10T12:00:00Z');
    expect(i.periodEvents.map((e) => e.at)).toEqual(['2026-03-10T12:00:00Z']);
    expect(i.periodTitles.get(t.id)).toEqual({ genres: ['Ação'], rating: 9, duration: { minutes: 90, episodesWithoutRuntime: 0 } });
  });
});
