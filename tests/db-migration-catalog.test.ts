import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrateAddCatalogSources, openDb } from '../src/server/db.ts';

/** Schema da época em que `titles.source` ainda aceitava só tmdb/archive/telegram (antes de tvmaze/anilist). */
const TELEGRAM_ERA_SCHEMA = `
CREATE TABLE titles (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('tmdb', 'archive', 'telegram')),
  source_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  original_title TEXT,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  release_date TEXT,
  vote_average REAL,
  created_at TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  overview TEXT,
  air_date TEXT,
  poster_path TEXT,
  UNIQUE (title_id, season_number)
);
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  overview TEXT,
  air_date TEXT,
  runtime INTEGER,
  still_path TEXT,
  UNIQUE (season_id, episode_number)
);
CREATE TABLE library_entries (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL UNIQUE REFERENCES titles(id) ON DELETE CASCADE,
  watch_status TEXT NOT NULL CHECK (watch_status IN ('want', 'watching', 'watched', 'dropped')),
  rating INTEGER,
  notes TEXT,
  current_season INTEGER,
  current_episode INTEGER,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const seeded = (): Database => {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(TELEGRAM_ERA_SCHEMA);
  db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, poster_path, created_at) VALUES ('t1', 'tmdb', '1399', 'tv', 'Série', '/p.jpg', '2026-01-01')`);
  db.exec(`INSERT INTO seasons (id, title_id, season_number, name) VALUES ('s1', 't1', 1, 'T1')`);
  db.exec(`INSERT INTO episodes (id, season_id, episode_number, name, air_date) VALUES ('e1', 's1', 1, 'Ep', '2026-02-01')`);
  db.exec(`INSERT INTO library_entries (id, title_id, watch_status, added_at, updated_at) VALUES ('l1', 't1', 'watching', '2026-01-01', '2026-01-01')`);
  return db;
};

describe('migrateAddCatalogSources', () => {
  test('preserva títulos, temporadas, episódios e lista; passa a aceitar tvmaze e anilist', () => {
    const db = seeded();
    migrateAddCatalogSources(db);

    expect(db.query<{ title: string; poster_path: string }, []>('SELECT title, poster_path FROM titles WHERE id = \'t1\'').get()).toEqual({
      title: 'Série',
      poster_path: '/p.jpg',
    });
    expect(db.query<{ name: string }, []>('SELECT e.name FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.title_id = \'t1\'').get()?.name).toBe('Ep');
    expect(db.query<{ title_id: string }, []>("SELECT title_id FROM library_entries WHERE id = 'l1'").get()?.title_id).toBe('t1');

    expect(() => db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t2', 'tvmaze', '1', 'tv', 'A', '2026-01-01')`)).not.toThrow();
    expect(() => db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t3', 'anilist', '1', 'tv', 'B', '2026-01-01')`)).not.toThrow();
    expect(() => db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t4', 'netflix', '1', 'tv', 'C', '2026-01-01')`)).toThrow();
  });

  test('as FKs continuam valendo depois da troca de tabela: filho órfão é recusado', () => {
    const db = seeded();
    migrateAddCatalogSources(db);

    expect(() => db.exec(`INSERT INTO library_entries (id, title_id, watch_status, added_at, updated_at) VALUES ('l2', 'nope', 'want', '2026-01-01', '2026-01-01')`)).toThrow();
    expect(() => db.exec(`INSERT INTO seasons (id, title_id, season_number, name) VALUES ('s9', 'nope', 1, 'T')`)).toThrow();
  });

  test('apagar um título ainda limpa temporadas e lista (CASCADE sobrevive à troca)', () => {
    const db = seeded();
    migrateAddCatalogSources(db);
    db.exec("DELETE FROM titles WHERE id = 't1'");
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM seasons').get()?.n).toBe(0);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM library_entries').get()?.n).toBe(0);
  });

  test('é idempotente: a segunda rodada não mexe em nada', () => {
    const db = seeded();
    migrateAddCatalogSources(db);
    db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t2', 'tvmaze', '77', 'tv', 'Nova', '2026-01-01')`);
    migrateAddCatalogSources(db);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n).toBe(2);
    expect(db.query<{ title: string }, []>("SELECT title FROM titles WHERE id = 't2'").get()?.title).toBe('Nova');
  });

  test('banco novo (openDb) já nasce aceitando as novas fontes', () => {
    const db = openDb(':memory:');
    expect(() => db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('x', 'anilist', '5', 'tv', 'Anime', '2026-01-01')`)).not.toThrow();
    expect(() => db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('y', 'tvmaze', '5', 'tv', 'Série', '2026-01-01')`)).not.toThrow();
  });
});
