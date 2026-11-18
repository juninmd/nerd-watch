import type { Database } from 'bun:sqlite';

/**
 * Tópicos de fórum e mensagens fixadas do canal. Tudo aditivo e idempotente (roda em todo start).
 * Rollback: `DROP TABLE telegram_topics; DROP TABLE telegram_pins; ALTER TABLE telegram_items DROP COLUMN topic_id;`.
 * `topic_id` nulo = vídeo fora de tópico (canal sem fórum, ou o tópico "Geral").
 */
export const migrateAddTelegramTopics = (db: Database): void => {
  const hasItems = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'telegram_items'").get();
  if (!hasItems || hasItems.n === 0) return;
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(telegram_items)').all();
  if (!columns.some((c) => c.name === 'topic_id')) db.exec('ALTER TABLE telegram_items ADD COLUMN topic_id TEXT;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_topics (
      channel_id TEXT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel_id, topic_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_pins (
      channel_id TEXT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      text TEXT,
      posted_at TEXT,
      PRIMARY KEY (channel_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_channel_meta (
      channel_id TEXT PRIMARY KEY REFERENCES telegram_channels(id) ON DELETE CASCADE,
      synced_at TEXT NOT NULL
    );
  `);
};
