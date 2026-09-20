import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.ts';

let instance: Database | undefined;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS titles (
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

CREATE TABLE IF NOT EXISTS telegram_channels (
  id TEXT PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('public', 'personal', 'bot')),
  handle TEXT NOT NULL,
  cursor TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_items (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  caption TEXT,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  posted_at TEXT,
  file_ref TEXT,
  UNIQUE (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_seasons_title ON seasons(title_id);
CREATE INDEX IF NOT EXISTS idx_telegram_items_channel ON telegram_items(channel_id);
`;

/**
 * `titles.source` já existia com CHECK sem 'telegram'; SQLite não faz ALTER de CHECK, então recriamos a
 * tabela preservando os dados. Idempotente: só roda se o CHECK antigo ainda estiver lá.
 *
 * Importante: criamos a tabela nova sob um nome temporário e no final renomeamos ELA para `titles` (em vez
 * de tirar `titles` do caminho primeiro) — porque `ALTER TABLE titles RENAME TO ...` faz o SQLite reescrever
 * automaticamente as FKs de `seasons`/`episodes`/`library_entries` para apontar pro nome novo, quebrando a
 * relação com a tabela `titles` recriada.
 */
export const migrateAddTelegramSource = (db: Database): void => {
  const row = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'titles'").get();
  if (!row || row.sql.includes("'telegram'")) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE titles_new (
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
    `);
    db.exec(`INSERT INTO titles_new SELECT * FROM titles`);
    db.exec(`DROP TABLE titles`);
    db.exec(`ALTER TABLE titles_new RENAME TO titles`);
  })();
  db.exec('PRAGMA foreign_keys = ON;');
};

/** `telegram_items.file_ref` foi adicionada depois; `ADD COLUMN` simples resolve (sem a dança de CHECK). */
export const migrateAddTelegramItemFileRef = (db: Database): void => {
  const hasTable = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'telegram_items'").get();
  if (!hasTable || hasTable.n === 0) return;
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(telegram_items)').all();
  if (columns.some((c) => c.name === 'file_ref')) return;
  db.exec('ALTER TABLE telegram_items ADD COLUMN file_ref TEXT;');
};

export const openDb = (path: string = config.dbPath): Database => {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  migrateAddTelegramSource(db);
  migrateAddTelegramItemFileRef(db);
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

/** Só para testes de rota: injeta a instância que `getDb()` deve devolver (evita tocar `data/nerd-watch.db`). */
export const resetDbForTests = (db?: Database): void => {
  instance = db;
};
