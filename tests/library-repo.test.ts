import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { getLibraryEntryByTitle, listLibrary, removeLibraryEntry, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

const seedTitle = () =>
  upsertTitle(db, { source: 'tmdb', sourceId: '42', mediaType: 'movie', title: 'Filme Teste' });

describe('upsertTitle', () => {
  test('é idempotente por (source, sourceId)', () => {
    const a = seedTitle();
    const b = seedTitle();
    expect(a.id).toBe(b.id);
  });

  test('tmdb e archive com o mesmo sourceId não colidem', () => {
    const t = upsertTitle(db, { source: 'tmdb', sourceId: 'x1', mediaType: 'movie', title: 'A' });
    const a = upsertTitle(db, { source: 'archive', sourceId: 'x1', mediaType: 'movie', title: 'B' });
    expect(t.id).not.toBe(a.id);
  });
});

describe('upsertLibraryEntry', () => {
  test('cria entrada nova com status padrão "want"', () => {
    const title = seedTitle();
    const entry = upsertLibraryEntry(db, title.id, {});
    expect(entry.watch_status).toBe('want');
    expect(entry.title.id).toBe(title.id);
  });

  test('atualiza em vez de duplicar quando já existe', () => {
    const title = seedTitle();
    upsertLibraryEntry(db, title.id, { watchStatus: 'want' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 3 });

    const all = listLibrary(db);
    expect(all).toHaveLength(1);
    expect(all[0]?.watch_status).toBe('watching');
    expect(all[0]?.current_episode).toBe(3);
  });

  test('preserva campos não enviados no patch', () => {
    const title = seedTitle();
    upsertLibraryEntry(db, title.id, { watchStatus: 'watching', rating: 8 });
    const updated = upsertLibraryEntry(db, title.id, { currentEpisode: 2 });
    expect(updated.rating).toBe(8);
    expect(updated.watch_status).toBe('watching');
  });

  test('rating explícito null limpa o valor anterior', () => {
    const title = seedTitle();
    upsertLibraryEntry(db, title.id, { rating: 8 });
    const updated = upsertLibraryEntry(db, title.id, { rating: null });
    expect(updated.rating).toBeNull();
  });
});

describe('listLibrary', () => {
  test('filtra por status', () => {
    const t1 = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'A' });
    const t2 = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'movie', title: 'B' });
    upsertLibraryEntry(db, t1.id, { watchStatus: 'watching' });
    upsertLibraryEntry(db, t2.id, { watchStatus: 'watched' });

    expect(listLibrary(db, 'watching')).toHaveLength(1);
    expect(listLibrary(db, 'watched')).toHaveLength(1);
    expect(listLibrary(db)).toHaveLength(2);
  });
});

describe('removeLibraryEntry', () => {
  test('remove sem apagar o título', () => {
    const title = seedTitle();
    const entry = upsertLibraryEntry(db, title.id, {});
    removeLibraryEntry(db, entry.id);
    expect(getLibraryEntryByTitle(db, title.id)).toBeNull();
  });
});
