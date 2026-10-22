import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import { importWatched } from '../src/server/providers/trakt/import.ts';
import { connectEnv, details, disconnectEnv, fakeTmdb, installFakeTrakt, movieWatched, showWatched } from './trakt-harness.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
  connectEnv();
});

afterEach(() => {
  disconnectEnv();
  db.close();
});

const catalog = {
  'movie:101': details('Filme Fake'),
  'tv:202': details('Série Fake', [{ season_number: 1, episode_count: 2 }]),
  'tv:303': details('Série Longa', [{ season_number: 1, episode_count: 3 }]),
};

const seedTmdbTitle = (sourceId: string, mediaType: 'movie' | 'tv') =>
  upsertTitle(db, { source: 'tmdb', sourceId, mediaType, title: `existente ${sourceId}` });

describe('importWatched: cria o que falta e marca conforme o Trakt', () => {
  test('filme vira assistido, série completa vira assistido, série parcial vira assistindo com o ponteiro', async () => {
    installFakeTrakt({
      movies: [movieWatched(101)],
      shows: [showWatched(202, { 1: [1, 2] }), showWatched(303, { 1: [1, 2] })],
    });

    const counts = await importWatched(db, fakeTmdb(catalog));

    expect(counts).toEqual({ imported: 3, updated: 0, unchanged: 0, skippedNoTmdb: 0, failed: 0 });
    const movie = getLibraryEntryByTitle(db, seedId('movie', 101));
    expect(movie?.watch_status).toBe('watched');
    const complete = getLibraryEntryByTitle(db, seedId('tv', 202));
    expect(complete?.watch_status).toBe('watched');
    const partial = getLibraryEntryByTitle(db, seedId('tv', 303));
    expect(partial?.watch_status).toBe('watching');
    expect([partial?.current_season, partial?.current_episode]).toEqual([1, 2]);
  });

  test('é idempotente: rodar de novo não muda nada', async () => {
    installFakeTrakt({ movies: [movieWatched(101)], shows: [showWatched(303, { 1: [1, 2] })] });
    await importWatched(db, fakeTmdb(catalog));

    const again = await importWatched(db, fakeTmdb(catalog));

    expect(again).toEqual({ imported: 0, updated: 0, unchanged: 2, skippedNoTmdb: 0, failed: 0 });
  });

  test('série parcial com ponteiro já à frente do Trakt não recua o ponteiro', async () => {
    installFakeTrakt({ movies: [], shows: [showWatched(303, { 1: [1, 2] })] });
    const title = seedTmdbTitle('303', 'tv');
    upsertLibraryEntry(db, title.id, { watchStatus: 'watching', currentSeason: 2, currentEpisode: 4 });

    const counts = await importWatched(db, fakeTmdb(catalog));

    expect(counts.unchanged).toBe(1);
    const entry = getLibraryEntryByTitle(db, title.id);
    expect([entry?.current_season, entry?.current_episode]).toEqual([2, 4]);
  });

  test('nunca rebaixa: "assistido" no app continua assistido mesmo com dados parciais no Trakt', async () => {
    installFakeTrakt({ movies: [], shows: [showWatched(303, { 1: [1] })] });
    const title = seedTmdbTitle('303', 'tv');
    upsertLibraryEntry(db, title.id, { watchStatus: 'watched' });

    await importWatched(db, fakeTmdb(catalog));

    expect(getLibraryEntryByTitle(db, title.id)?.watch_status).toBe('watched');
  });

  test('abandonado no app é decisão do usuário: o import não o reabre', async () => {
    installFakeTrakt({ movies: [movieWatched(101)], shows: [] });
    const title = seedTmdbTitle('101', 'movie');
    upsertLibraryEntry(db, title.id, { watchStatus: 'dropped' });

    const counts = await importWatched(db, fakeTmdb(catalog));

    expect(getLibraryEntryByTitle(db, title.id)?.watch_status).toBe('dropped');
    expect(counts.unchanged).toBe(1);
  });

  test('entrada "quero ver" existente vira assistido sem criar outra entrada', async () => {
    installFakeTrakt({ movies: [movieWatched(101)], shows: [] });
    const title = seedTmdbTitle('101', 'movie');
    upsertLibraryEntry(db, title.id, { watchStatus: 'want' });

    const counts = await importWatched(db, fakeTmdb(catalog));

    expect(counts).toEqual({ imported: 0, updated: 1, unchanged: 0, skippedNoTmdb: 0, failed: 0 });
    expect(getLibraryEntryByTitle(db, title.id)?.watch_status).toBe('watched');
  });
});

describe('importWatched: sem TMDB nunca inventa título', () => {
  test('título ausente e sem TMDB_API_KEY: conta como ignorado e não cria nada', async () => {
    installFakeTrakt({ movies: [movieWatched(101)], shows: [showWatched(202, { 1: [1, 2] })] });

    const tmdb = fakeTmdb(catalog, false);
    const counts = await importWatched(db, tmdb);

    expect(counts).toEqual({ imported: 0, updated: 0, unchanged: 0, skippedNoTmdb: 2, failed: 0 });
    expect(tmdb.requested).toEqual([]);
    expect(db.query('SELECT COUNT(*) AS n FROM titles').get()).toEqual({ n: 0 });
  });

  test('título que já existe no app é atualizado mesmo sem TMDB_API_KEY (série fica "assistindo")', async () => {
    installFakeTrakt({ movies: [], shows: [showWatched(202, { 1: [1, 2] })] });
    seedTmdbTitle('202', 'tv');

    const counts = await importWatched(db, fakeTmdb(catalog, false));

    expect(counts.imported).toBe(1);
    expect(getLibraryEntryByTitle(db, seedId('tv', 202))?.watch_status).toBe('watching');
  });

  test('item do Trakt sem id TMDB é contado como ignorado, nunca casado por título', async () => {
    const noTmdb = { ...movieWatched(101), movie: { title: 'Sem id', year: 1999, ids: { trakt: 9 } } };
    installFakeTrakt({ movies: [noTmdb], shows: [] });

    const counts = await importWatched(db, fakeTmdb(catalog));

    expect(counts).toEqual({ imported: 0, updated: 0, unchanged: 0, skippedNoTmdb: 1, failed: 0 });
  });

  test('falha da TMDB ao criar o título conta como falha e não deixa título pela metade', async () => {
    installFakeTrakt({ movies: [movieWatched(999)], shows: [] });

    const counts = await importWatched(db, fakeTmdb(catalog));

    expect(counts).toEqual({ imported: 0, updated: 0, unchanged: 0, skippedNoTmdb: 0, failed: 1 });
    expect(db.query('SELECT COUNT(*) AS n FROM titles').get()).toEqual({ n: 0 });
  });
});

describe('importWatched: série completa exige prova da TMDB', () => {
  test('episódio faltando na TMDB: série não é marcada como completa', async () => {
    installFakeTrakt({ movies: [], shows: [showWatched(303, { 1: [1, 2] })] });

    await importWatched(db, fakeTmdb(catalog));

    expect(getLibraryEntryByTitle(db, seedId('tv', 303))?.watch_status).toBe('watching');
  });

  test('temporada que o Trakt não viu: série fica parcial', async () => {
    const two = { ...catalog, 'tv:202': details('Série Fake', [{ season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 1 }]) };
    installFakeTrakt({ movies: [], shows: [showWatched(202, { 1: [1, 2] })] });

    await importWatched(db, fakeTmdb(two));

    expect(getLibraryEntryByTitle(db, seedId('tv', 202))?.watch_status).toBe('watching');
  });
});

describe('importWatched: refresh token gira a cada uso', () => {
  test('o refresh token novo do Trakt substitui o antigo (uso único)', async () => {
    installFakeTrakt({ movies: [movieWatched(101)], shows: [] });

    await importWatched(db, fakeTmdb(catalog));

    expect(process.env.TRAKT_REFRESH_TOKEN).toBe('fake-refresh-2');
  });
});

/** id interno do título TMDB criado pelo import (a tabela não é consultada pelo tipo, só pelo source_id). */
function seedId(mediaType: 'movie' | 'tv', tmdbId: number): string {
  const row = db.query<{ id: string }, [string, string]>("SELECT id FROM titles WHERE source = 'tmdb' AND source_id = ? AND media_type = ?").get(String(tmdbId), mediaType);
  if (!row) throw new Error(`título ${mediaType}:${tmdbId} não foi criado`);
  return row.id;
}
