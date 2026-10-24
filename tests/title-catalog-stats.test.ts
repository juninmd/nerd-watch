import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { getTitle, setCatalogStats, updateTitleMetadata, upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

const metadata = (overrides: Partial<Parameters<typeof updateTitleMetadata>[2]> = {}) => ({
  title: 'Filme',
  overview: null,
  posterPath: null,
  backdropPath: null,
  releaseDate: '2020-01-01',
  voteAverage: 7,
  status: 'Released',
  genres: ['Drama'],
  runtimeMinutes: 110,
  ...overrides,
});

describe('setCatalogStats: gênero e duração são catálogo, não lista do usuário', () => {
  test('grava gêneros (JSON) e duração', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
    setCatalogStats(db, t.id, { genres: ['Drama', 'Mistério'], runtimeMinutes: 120 });
    const row = getTitle(db, t.id);
    expect(row?.genres).toBe('["Drama","Mistério"]');
    expect(row?.runtime_minutes).toBe(120);
  });

  test('ausência do campo (null) não apaga o valor que já estava guardado', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'movie', title: 'Filme' });
    setCatalogStats(db, t.id, { genres: ['Ação'], runtimeMinutes: 95 });
    setCatalogStats(db, t.id, { genres: null, runtimeMinutes: null });
    expect(getTitle(db, t.id)?.genres).toBe('["Ação"]');
    expect(getTitle(db, t.id)?.runtime_minutes).toBe(95);
  });

  test('lista vazia não apaga gêneros já guardados (resposta parcial do catálogo)', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '3', mediaType: 'movie', title: 'Filme' });
    setCatalogStats(db, t.id, { genres: ['Ação'], runtimeMinutes: null });
    setCatalogStats(db, t.id, { genres: [], runtimeMinutes: null });
    expect(getTitle(db, t.id)?.genres).toBe('["Ação"]');
  });

  test('lista vazia vira [] quando nada estava guardado (catálogo respondeu sem gênero)', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '5', mediaType: 'movie', title: 'Filme' });
    setCatalogStats(db, t.id, { genres: [], runtimeMinutes: null });
    expect(getTitle(db, t.id)?.genres).toBe('[]');
  });

  test('não mexe em library_entries (status, nota e progresso são do usuário)', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '4', mediaType: 'tv', title: 'Série' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching', rating: 8, currentSeason: 2, currentEpisode: 3 });
    setCatalogStats(db, t.id, { genres: ['Drama'], runtimeMinutes: 45 });
    const entry = db
      .query<{ watch_status: string; rating: number; current_season: number; current_episode: number }, []>(
        'SELECT watch_status, rating, current_season, current_episode FROM library_entries',
      )
      .get();
    expect(entry).toEqual({ watch_status: 'watching', rating: 8, current_season: 2, current_episode: 3 });
  });

  test('título inexistente: nenhuma linha é criada', () => {
    setCatalogStats(db, 'nao-existe', { genres: ['Drama'], runtimeMinutes: 10 });
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n).toBe(0);
  });
});

describe('updateTitleMetadata (refresh) grava gênero e duração com a mesma regra', () => {
  test('atualiza catálogo; sem genres/runtime do provider mantém o anterior', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '5', mediaType: 'movie', title: 'Filme' });
    updateTitleMetadata(db, t.id, metadata(), '2026-10-22T00:00:00.000Z');
    expect(getTitle(db, t.id)?.genres).toBe('["Drama"]');
    updateTitleMetadata(
      db,
      t.id,
      metadata({ genres: null, runtimeMinutes: null, title: 'Filme novo' }),
      '2026-10-23T00:00:00.000Z',
    );
    const row = getTitle(db, t.id);
    expect(row?.title).toBe('Filme novo');
    expect(row?.genres).toBe('["Drama"]');
    expect(row?.runtime_minutes).toBe(110);
    expect(row?.metadata_refreshed_at).toBe('2026-10-23T00:00:00.000Z');
  });
});

describe('lista vazia do provider não apaga gêneros conhecidos', () => {
  test('genres [] com gênero já guardado mantém o anterior', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '6', mediaType: 'movie', title: 'Filme' });
    setCatalogStats(db, t.id, { genres: ['Drama'], runtimeMinutes: 90 });
    setCatalogStats(db, t.id, { genres: [], runtimeMinutes: null });
    expect(getTitle(db, t.id)?.genres).toBe('["Drama"]');
  });

  test('genres [] na primeira vez ainda grava (fim do backfill, sem loop)', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: '7', mediaType: 'movie', title: 'Filme' });
    setCatalogStats(db, t.id, { genres: [], runtimeMinutes: null });
    expect(getTitle(db, t.id)?.genres).toBe('[]');
  });
});
