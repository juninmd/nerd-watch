import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from './config.ts';
import { LIBRARY_HISTORY_KINDS, TELEGRAM_CHANNEL_MODES } from './types.ts';

let instance: Database | undefined;

const MODES_SQL = TELEGRAM_CHANNEL_MODES.map((m) => `'${m}'`).join(', ');
const HISTORY_KINDS_SQL = LIBRARY_HISTORY_KINDS.map((k) => `'${k}'`).join(', ');

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('tmdb', 'archive', 'telegram', 'tvmaze', 'anilist')),
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
  metadata_status TEXT,
  metadata_refreshed_at TEXT,
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
  mode TEXT NOT NULL CHECK (mode IN (${MODES_SQL})),
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

/* Progresso de reprodução por vídeo (chave = a mesma do cliente). Criada com IF NOT EXISTS: idempotente. */
CREATE TABLE IF NOT EXISTS playback_positions (
  key TEXT PRIMARY KEY,
  seconds REAL NOT NULL,
  duration REAL,
  at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_playback_at ON playback_positions(at);

-- Origem (magnet normalizado) de cada torrent do provider genérico: o engine esquece o torrent quando
-- fica ocioso, então é daqui que ele é re-adicionado depois de um restart. Idempotente por CREATE IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS torrent_sources (
  infohash TEXT PRIMARY KEY,
  magnet TEXT NOT NULL,
  added_at TEXT NOT NULL
);

-- Histórico da lista por título (sobrevive à remoção da entrada). Só cresce: o import reaproveita os ids do backup.
CREATE TABLE IF NOT EXISTS library_history (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (${HISTORY_KINDS_SQL})),
  at TEXT NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_library_history_title ON library_history(title_id, at);
-- Avisos de lançamento já entregues (chave = título + episódio/data). Sem isso, um restart repetiria os avisos.
CREATE TABLE IF NOT EXISTS notifications_sent (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_air_date ON episodes(air_date);
CREATE INDEX IF NOT EXISTS idx_seasons_title ON seasons(title_id);
CREATE INDEX IF NOT EXISTS idx_telegram_items_channel ON telegram_items(channel_id);
CREATE INDEX IF NOT EXISTS idx_library_status ON library_entries(watch_status);
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

/**
 * `titles.source` ganhou 'tvmaze' e 'anilist' (catálogos sem chave). Mesma técnica do telegram: recria a tabela
 * com o CHECK novo e preserva as FKs. Idempotente pelo marcador 'anilist' no SQL.
 *
 * Rollback (só se precisar voltar a versão): apague antes as linhas novas
 * (`DELETE FROM titles WHERE source IN ('tvmaze','anilist')`, o CASCADE limpa temporadas, episódios e lista)
 * e recrie a tabela com o CHECK anterior, usando a mesma sequência de `migrateAddTelegramSource`.
 */
export const migrateAddCatalogSources = (db: Database): void => {
  const row = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'titles'").get();
  if (!row || row.sql.includes("'anilist'")) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE titles_new (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('tmdb', 'archive', 'telegram', 'tvmaze', 'anilist')),
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

/**
 * `telegram_channels.mode` ganhou as fontes de arquivo (Drive, WebDAV, pasta local…: reaproveitam canais, fila e
 * player). Mesmo motivo e mesma técnica da migração do `titles`: o CHECK não se altera, então recria a tabela sob
 * nome temporário e renomeia a nova. Idempotente: só roda se algum modo ainda não estiver no CHECK.
 */
export const migrateChannelModes = (db: Database): void => {
  const row = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'telegram_channels'").get();
  if (!row || TELEGRAM_CHANNEL_MODES.every((m) => row.sql.includes(`'${m}'`))) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE telegram_channels_new (
        id TEXT PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN (${MODES_SQL})),
        handle TEXT NOT NULL,
        cursor TEXT,
        created_at TEXT NOT NULL
      );
    `);
    db.exec('INSERT INTO telegram_channels_new SELECT id, mode, handle, cursor, created_at FROM telegram_channels');
    db.exec('DROP TABLE telegram_channels');
    db.exec('ALTER TABLE telegram_channels_new RENAME TO telegram_channels');
  })();
  db.exec('PRAGMA foreign_keys = ON;');
};

/**
 * `titles` ganhou o status da série na TMDB e a data do último refresh de metadados (ver metadata/). Ambas são
 * nulas e `ADD COLUMN` basta. Se a tabela ainda não existe, não faz nada: o CREATE de MIGRATIONS já traz as colunas.
 * Deve rodar depois de `migrateAddCatalogSources` (que recria `titles` com `SELECT *`).
 */
export const migrateAddTitleMetadataRefresh = (db: Database): void => {
  const hasTable = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'titles'").get();
  if (!hasTable || hasTable.n === 0) return;
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(titles)').all().map((c) => c.name);
  if (!columns.includes('metadata_status')) db.exec('ALTER TABLE titles ADD COLUMN metadata_status TEXT;');
  if (!columns.includes('metadata_refreshed_at')) db.exec('ALTER TABLE titles ADD COLUMN metadata_refreshed_at TEXT;');
};

/** `telegram_items.file_ref` foi adicionada depois; `ADD COLUMN` simples resolve (sem a dança de CHECK). */
export const migrateAddTelegramItemFileRef = (db: Database): void => {
  const hasTable = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'telegram_items'").get();
  if (!hasTable || hasTable.n === 0) return;
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(telegram_items)').all();
  if (columns.some((c) => c.name === 'file_ref')) return;
  db.exec('ALTER TABLE telegram_items ADD COLUMN file_ref TEXT;');
};

/** `library_entries.rewatch_count` (quantas revisões). Roda depois de MIGRATIONS: a tabela já existe em qualquer banco. */
export const migrateAddRewatchCount = (db: Database): void => {
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(library_entries)').all();
  if (columns.some((c) => c.name === 'rewatch_count')) return;
  db.exec('ALTER TABLE library_entries ADD COLUMN rewatch_count INTEGER NOT NULL DEFAULT 0;');
};

export const openDb = (path: string = config.dbPath): Database => {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  migrateAddTelegramSource(db);
  migrateAddTelegramItemFileRef(db);
  migrateChannelModes(db);
  migrateAddCatalogSources(db);
  migrateAddTitleMetadataRefresh(db);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRATIONS);
  migrateAddRewatchCount(db);
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
