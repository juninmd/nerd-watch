import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.ts';

let instance: Database | undefined;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('tmdb', 'archive')),
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

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  overview TEXT,
  air_date TEXT,
  poster_path TEXT,
  UNIQUE (title_id, season_number)
);

CREATE TABLE IF NOT EXISTS episodes (
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

CREATE TABLE IF NOT EXISTS library_entries (
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

CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_seasons_title ON seasons(title_id);
`;

export const openDb = (path: string = config.dbPath): Database => {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRATIONS);
  return db;
};

/** Singleton usado pelo servidor; testes abrem sua própria instância (`:memory:`). */
export const getDb = async (): Promise<Database> => {
  if (instance) return instance;
  if (config.dbPath !== ':memory:') await mkdir(dirname(config.dbPath), { recursive: true });
  instance = openDb(config.dbPath);
  return instance;
};
