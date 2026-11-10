/**
 * Listas próprias e visões salvas da biblioteca. Só CREATE ... IF NOT EXISTS: aditivo e idempotente, entra no
 * MIGRATIONS de db.ts como qualquer tabela nova (ver playback_positions). Apagar a lista ou o título leva os itens.
 */
export const LISTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, title_id)
);

CREATE INDEX IF NOT EXISTS idx_list_items_position ON list_items(list_id, position);
CREATE INDEX IF NOT EXISTS idx_list_items_title ON list_items(title_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  query TEXT NOT NULL CHECK (length(query) <= 512),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
