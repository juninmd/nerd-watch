import type { Database } from 'bun:sqlite';

/**
 * Vínculo entre um vídeo do canal e um episódio da biblioteca. Colunas aditivas e nulas: sem vínculo = tudo nulo.
 * `link_status`: 'suggested' (confirmar) ou 'linked' (conta para "Onde parei"). `link_source`: 'auto' (casamento
 * determinístico) ou 'manual' (decisão do usuário, inclusive "sem vínculo", que o automático respeita).
 * Rollback: `ALTER TABLE telegram_items DROP COLUMN ...` para cada coluna; nada depende delas fora do vínculo.
 */
const LINK_COLUMNS: ReadonlyArray<[name: string, sql: string]> = [
  ['title_id', 'TEXT REFERENCES titles(id) ON DELETE SET NULL'],
  ['season_number', 'INTEGER'],
  ['episode_number', 'INTEGER'],
  ['episode_end', 'INTEGER'],
  ['link_status', "TEXT CHECK (link_status IN ('suggested', 'linked'))"],
  ['link_source', "TEXT CHECK (link_source IN ('auto', 'manual'))"],
  ['link_confidence', 'REAL'],
];

/** Um `ADD COLUMN` por coluna que falta. Idempotente: roda em todo start e não mexe no que já existe. */
export const migrateAddTelegramItemLink = (db: Database): void => {
  const hasTable = db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'telegram_items'",
    )
    .get();
  if (!hasTable || hasTable.n === 0) return;
  const existing = new Set(
    db
      .query<{ name: string }, []>('PRAGMA table_info(telegram_items)')
      .all()
      .map((c) => c.name),
  );
  for (const [name, sql] of LINK_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE telegram_items ADD COLUMN ${name} ${sql};`);
  }
};
