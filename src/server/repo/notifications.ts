import type { Database } from 'bun:sqlite';

/** Quais das chaves já foram entregues. Uma consulta com `json_each`: sem IN dinâmico nem limite de parâmetros. */
export const sentKeys = (db: Database, keys: readonly string[]): Set<string> => {
  if (keys.length === 0) return new Set();
  const rows = db
    .query<{ key: string }, [string]>('SELECT key FROM notifications_sent WHERE key IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(keys));
  return new Set(rows.map((row) => row.key));
};

/** `INSERT OR IGNORE`: marcar duas vezes a mesma chave não falha nem duplica. */
export const markNotificationSent = (db: Database, key: string, sentAt: string = new Date().toISOString()): void => {
  db.query('INSERT OR IGNORE INTO notifications_sent (key, sent_at) VALUES (?, ?)').run(key, sentAt);
};
