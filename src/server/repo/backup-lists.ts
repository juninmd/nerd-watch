import type { Database } from 'bun:sqlite';
import { validateDescription, validateListName } from '../lists/rules.ts';
import { parseStoredViewQuery, parseViewName } from '../saved-views/schema.ts';
import { ValidationError } from '../validation-error.ts';
import type { ListRow } from './lists.ts';
import type { SavedViewRow } from './saved-views.ts';

/** Campos de listas no backup. Opcionais: backups anteriores não os têm. */
export interface ListItemRow {
  list_id: string;
  title_id: string;
  position: number;
  added_at: string;
}

export interface ListsBackupFields {
  lists?: ListRow[];
  listItems?: ListItemRow[];
  savedViews?: SavedViewRow[];
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isPosition = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

const requireArray = (data: Record<string, unknown>, key: string): unknown[] | undefined => {
  if (data[key] === undefined) return undefined;
  if (!Array.isArray(data[key])) throw new ValidationError(`campo "${key}" inválido`);
  return data[key] as unknown[];
};

/**
 * Valida as listas do backup antes de abrir a transação: uma linha ruim não pode deixar a importação pela metade.
 * Reaproveita as regras de entrada (nome, descrição, visão), então um backup adulterado não grava o que a API recusa.
 */
export const validateListsBackup = (data: Record<string, unknown>): void => {
  for (const row of requireArray(data, 'lists') ?? []) {
    const r = row as Record<string, unknown>;
    if (!isText(r.id)) throw new ValidationError('lista sem id');
    validateListName(r.name);
    validateDescription(r.description);
  }
  for (const row of requireArray(data, 'listItems') ?? []) {
    const r = row as Record<string, unknown>;
    if (!isText(r.list_id) || !isText(r.title_id) || !isPosition(r.position) || !isText(r.added_at)) {
      throw new ValidationError('item de lista inválido (list_id, title_id, position ou added_at)');
    }
  }
  for (const row of requireArray(data, 'savedViews') ?? []) {
    const r = row as Record<string, unknown>;
    if (!isText(r.id)) throw new ValidationError('visão sem id');
    parseViewName(r.name);
    if (typeof r.query !== 'string') throw new ValidationError('visão sem combinação (query)');
    parseStoredViewQuery(r.query);
  }
};

/** Mesma regra dos demais dados: ON CONFLICT DO UPDATE (não OR REPLACE), para não cascatear deleções. */
export const importListsBackup = (db: Database, data: ListsBackupFields): { lists: number; savedViews: number } => {
  const insertList = db.query(
    `INSERT INTO lists (id, name, description, created_at, updated_at) VALUES ($id, $name, $description, $created_at, $updated_at)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
       created_at = excluded.created_at, updated_at = excluded.updated_at`,
  );
  const insertItem = db.query(
    `INSERT INTO list_items (list_id, title_id, position, added_at) VALUES ($list_id, $title_id, $position, $added_at)
     ON CONFLICT (list_id, title_id) DO UPDATE SET position = excluded.position, added_at = excluded.added_at`,
  );
  const insertView = db.query(
    `INSERT INTO saved_views (id, name, query, created_at, updated_at) VALUES ($id, $name, $query, $created_at, $updated_at)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, query = excluded.query, created_at = excluded.created_at, updated_at = excluded.updated_at`,
  );

  for (const l of data.lists ?? []) {
    insertList.run({
      $id: l.id,
      $name: l.name,
      $description: l.description ?? null,
      $created_at: l.created_at,
      $updated_at: l.updated_at,
    });
  }
  for (const i of data.listItems ?? []) {
    insertItem.run({ $list_id: i.list_id, $title_id: i.title_id, $position: i.position, $added_at: i.added_at });
  }
  for (const v of data.savedViews ?? []) {
    insertView.run({ $id: v.id, $name: v.name, $query: v.query, $created_at: v.created_at, $updated_at: v.updated_at });
  }
  return { lists: data.lists?.length ?? 0, savedViews: data.savedViews?.length ?? 0 };
};
