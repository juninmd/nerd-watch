import type { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { openDb } from '../src/server/db.ts';
import { newBackoff, runRefreshTick } from '../src/server/metadata/refresh-job.ts';
import { needsRefresh, needsStatsBackfill } from '../src/server/metadata/refresh-policy.ts';
import { refreshTitle } from '../src/server/metadata/refresher.ts';
import type { TmdbTitleDetails } from '../src/server/providers/tmdb.ts';
import { listFollowedTmdbTitles, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { getTitle, updateTitleMetadata, upsertTitle } from '../src/server/repo/titles.ts';

const NOW = new Date('2026-10-22T12:00:00.000Z');

const movie = (overrides: Partial<TmdbTitleDetails> = {}): TmdbTitleDetails => ({
  id: 603,
  title: 'Matrix',
  overview: '',
  poster_path: null,
  backdrop_path: null,
  release_date: '1999-03-31',
  vote_average: 8.2,
  status: 'Released',
  genres: ['Ação', 'Ficção científica'],
  runtimeMinutes: 136,
  ...overrides,
});

/** Filme já lançado, assistido, nunca atualizado e sem gêneros: o caso que a política de refresh ignorava. */
const seedLegacyWatchedMovie = (db: Database): string => {
  const t = upsertTitle(db, {
    source: 'tmdb',
    sourceId: '603',
    mediaType: 'movie',
    title: 'Matrix',
    releaseDate: '1999-03-31',
  });
  // Já atualizado antes da migração: sem gêneros, mas com refresh recente, a política de intervalo o deixaria de fora.
  updateTitleMetadata(
    db,
    t.id,
    {
      title: 'Matrix',
      overview: null,
      posterPath: null,
      backdropPath: null,
      releaseDate: '1999-03-31',
      voteAverage: 8.2,
      status: 'Released',
      genres: null,
      runtimeMinutes: null,
    },
    '2026-01-01T00:00:00.000Z',
  );
  upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
  return t.id;
};

describe('needsStatsBackfill', () => {
  test('gêneros nulos pedem backfill; lista (mesmo vazia) já está preenchida', () => {
    const withGenres = (genres: string | null) => ({
      media_type: 'movie' as const,
      release_date: null,
      metadata_status: null,
      metadata_refreshed_at: null,
      genres,
    });
    expect(needsStatsBackfill(withGenres(null))).toBe(true);
    expect(needsStatsBackfill(withGenres('[]'))).toBe(false);
    expect(needsStatsBackfill(withGenres('["Drama"]'))).toBe(false);
  });
});

describe('backfill pelo refresh automático', () => {
  test('filme já lançado, assistido e sem gêneros entra na fila do tick (a política de intervalo o descartaria)', () => {
    const db = openDb(':memory:');
    const id = seedLegacyWatchedMovie(db);
    const row = listFollowedTmdbTitles(db, 10).find((t) => t.id === id);
    expect(row).toBeDefined();
    expect(needsRefresh(row as NonNullable<typeof row>, NOW)).toBe(false);
    expect(needsStatsBackfill(row as NonNullable<typeof row>)).toBe(true);
  });

  test('um tick preenche gêneros e duração; no tick seguinte o título sai da fila (sem repetição)', async () => {
    const db = openDb(':memory:');
    const id = seedLegacyWatchedMovie(db);
    let fetches = 0;
    const deps = {
      listCandidates: () => listFollowedTmdbTitles(db, 500),
      refresh: async (title: Parameters<typeof refreshTitle>[1]) => {
        fetches++;
        return refreshTitle(
          { db, fetchDetails: async () => movie(), fetchSeasonEpisodes: async () => [], now: () => NOW },
          title,
        );
      },
      now: () => NOW,
      maxPerTick: 5,
      log: () => {},
    };
    const backoff = newBackoff();

    const first = await runRefreshTick(deps, backoff);
    expect(first.refreshed).toBe(1);
    const row = getTitle(db, id);
    expect(row?.genres).toBe('["Ação","Ficção científica"]');
    expect(row?.runtime_minutes).toBe(136);

    const second = await runRefreshTick(deps, backoff);
    expect(second.attempted).toBe(0);
    expect(fetches).toBe(1);
  });

  test('o backfill respeita o teto por tick: vários títulos antigos não viram rajada', async () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 8; i++) {
      const t = upsertTitle(db, {
        source: 'tmdb',
        sourceId: String(1000 + i),
        mediaType: 'movie',
        title: `F${i}`,
        releaseDate: '2000-01-01',
      });
      upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    }
    const calls: string[] = [];
    const summary = await runRefreshTick(
      {
        listCandidates: () => listFollowedTmdbTitles(db, 500),
        refresh: async (title) => {
          calls.push(title.id);
          return refreshTitle(
            { db, fetchDetails: async () => movie(), fetchSeasonEpisodes: async () => [], now: () => NOW },
            title,
          );
        },
        now: () => NOW,
        maxPerTick: 5,
        log: () => {},
      },
      newBackoff(),
    );
    expect(summary.attempted).toBe(5);
    expect(calls).toHaveLength(5);
  });
});
