import type { Database } from 'bun:sqlite';
import { parseStoredViewQuery, serializeViewQuery, type LibraryViewQuery } from '../saved-views/schema.ts';
import { ValidationError } from '../validation-error.ts';

/** Teto de visões: a barra de chips e a paleta listam todas; sem teto a barra viraria uma lista sem fim. */
export const SAVED_VIEWS_MAX = 30;

export interface SavedViewRow {
  id: string;
  name: string;
  query: string;
  created_at: string;
  updated_at: string;
}

export interface SavedView {
  id: string;
  name: string;
  query: LibraryViewQuery;
  createdAt: string;
  updatedAt: string;
}

/** A linha guarda o JSON canônico; ao ler, passa de novo pela validação (um backup adulterado não vira visão). */
export const toSavedView = (row: SavedViewRow): SavedView => ({
  id: row.id,
  name: row.name,
  query: parseStoredViewQuery(row.query),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const listSavedViews = (db: Database): SavedView[] =>
  db
    .query<SavedViewRow, []>('SELECT * FROM saved_views ORDER BY name COLLATE NOCASE, id')
    .all()
    .map(toSavedView);

export const getSavedViewRow = (db: Database, id: string): SavedViewRow | null => db.query<SavedViewRow, [string]>('SELECT * FROM saved_views WHERE id = ?').get(id);

export const createSavedView = (db: Database, input: { name: string; query: LibraryViewQuery }): SavedView =>
  db.transaction((): SavedView => {
    const count = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM saved_views').get()?.n ?? 0;
    if (count >= SAVED_VIEWS_MAX) throw new ValidationError(`no máximo ${SAVED_VIEWS_MAX} visões salvas: apague uma antes`);
    const at = new Date().toISOString();
    const row: SavedViewRow = { id: crypto.randomUUID(), name: input.name, query: serializeViewQuery(input.query), created_at: at, updated_at: at };
    db.query('INSERT INTO saved_views (id, name, query, created_at, updated_at) VALUES ($id, $name, $query, $created_at, $updated_at)').run({
      $id: row.id,
      $name: row.name,
      $query: row.query,
      $created_at: at,
      $updated_at: at,
    });
    return toSavedView(row);
  })();

/** Campos ausentes ficam como estão. null = visão inexistente. */
export const updateSavedView = (db: Database, id: string, patch: { name?: string; query?: LibraryViewQuery }): SavedView | null => {
  const existing = getSavedViewRow(db, id);
  if (!existing) return null;
  const next = {
    name: patch.name ?? existing.name,
    query: patch.query ? serializeViewQuery(patch.query) : existing.query,
    updated_at: new Date().toISOString(),
  };
  db.query('UPDATE saved_views SET name = $name, query = $query, updated_at = $updated_at WHERE id = $id').run({
    $name: next.name,
    $query: next.query,
    $updated_at: next.updated_at,
    $id: id,
  });
  return toSavedView({ ...existing, ...next });
};

export const deleteSavedView = (db: Database, id: string): boolean => db.query('DELETE FROM saved_views WHERE id = ?').run(id).changes > 0;
