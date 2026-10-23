import type { Database } from 'bun:sqlite';
import type { MediaType, TitleSource } from '../types.ts';
import { LIST_ITEMS_MAX, checkPermutation, orderByPosition } from '../lists/rules.ts';
import { ValidationError } from '../validation-error.ts';
import { SQL_BATCH } from './titles.ts';

export interface ListRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Quantas capas (primeiros pôsteres) cada lista mostra no cartão. */
export const LIST_COVERS = 4;

export interface ListCover {
  source: TitleSource;
  posterPath: string | null;
}

export interface ListSummary extends ListRow {
  itemCount: number;
  /** Só quando a consulta pede um título (ex.: o botão "Adicionar à lista" do título); senão null. */
  containsTitle: boolean | null;
  covers: ListCover[];
}

export interface ListItemView {
  titleId: string;
  position: number;
  addedAt: string;
  title: {
    source: TitleSource;
    sourceId: string;
    mediaType: MediaType;
    title: string;
    posterPath: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
  };
}

const chunks = <T>(items: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += SQL_BATCH) out.push(items.slice(i, i + SQL_BATCH));
  return out;
};
const marks = (n: number): string => Array.from({ length: n }, () => '?').join(',');

export const getListRow = (db: Database, id: string): ListRow | null => db.query<ListRow, [string]>('SELECT * FROM lists WHERE id = ?').get(id);

export const createList = (db: Database, input: { name: string; description: string | null }): ListRow => {
  const at = new Date().toISOString();
  const row: ListRow = { id: crypto.randomUUID(), name: input.name, description: input.description, created_at: at, updated_at: at };
  db.query('INSERT INTO lists (id, name, description, created_at, updated_at) VALUES ($id, $name, $description, $created_at, $updated_at)').run({
    $id: row.id,
    $name: row.name,
    $description: row.description,
    $created_at: at,
    $updated_at: at,
  });
  return row;
};

/** Campos ausentes ficam como estão; `description: null` apaga a descrição. Devolve null se a lista não existe. */
export const updateList = (db: Database, id: string, patch: { name?: string; description?: string | null }): ListRow | null => {
  const existing = getListRow(db, id);
  if (!existing) return null;
  const next = {
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    updated_at: new Date().toISOString(),
  };
  db.query('UPDATE lists SET name = $name, description = $description, updated_at = $updated_at WHERE id = $id').run({
    $name: next.name,
    $description: next.description,
    $updated_at: next.updated_at,
    $id: id,
  });
  return { ...existing, ...next };
};

/** Os itens vão junto (ON DELETE CASCADE); os títulos não são apagados. */
export const deleteList = (db: Database, id: string): boolean => db.query('DELETE FROM lists WHERE id = ?').run(id).changes > 0;

const listCovers = (db: Database, listIds: string[]): Map<string, ListCover[]> => {
  const covers = new Map<string, ListCover[]>();
  for (const batch of chunks(listIds)) {
    const rows = db
      .query<{ list_id: string; source: TitleSource; poster_path: string | null }, string[]>(
        `SELECT x.list_id, x.source, x.poster_path FROM (
           SELECT li.list_id, t.source, t.poster_path,
             ROW_NUMBER() OVER (PARTITION BY li.list_id ORDER BY li.position, li.added_at, li.title_id) AS rn
           FROM list_items li JOIN titles t ON t.id = li.title_id
           WHERE li.list_id IN (${marks(batch.length)})
         ) x WHERE x.rn <= ${LIST_COVERS} ORDER BY x.list_id, x.rn`,
      )
      .all(...batch);
    for (const r of rows) {
      const list = covers.get(r.list_id) ?? [];
      list.push({ source: r.source, posterPath: r.poster_path });
      covers.set(r.list_id, list);
    }
  }
  return covers;
};

/** Página de listas (o limite é do chamador). `containsTitleId` marca quais listas já têm o título. */
export const listSummaries = (
  db: Database,
  opts: { limit: number; offset: number; containsTitleId: string | null },
): { items: ListSummary[]; total: number } => {
  const total = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lists').get()?.n ?? 0;
  const rows = db
    .query<ListRow & { item_count: number; contains: number | null }, { $tid: string | null; $limit: number; $offset: number }>(
      `SELECT l.*,
         (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id) AS item_count,
         CASE WHEN $tid IS NULL THEN NULL
              ELSE EXISTS (SELECT 1 FROM list_items li WHERE li.list_id = l.id AND li.title_id = $tid) END AS contains
       FROM lists l ORDER BY l.name COLLATE NOCASE, l.id LIMIT $limit OFFSET $offset`,
    )
    .all({ $tid: opts.containsTitleId, $limit: opts.limit, $offset: opts.offset });
  const covers = listCovers(
    db,
    rows.map((r) => r.id),
  );
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      created_at: r.created_at,
      updated_at: r.updated_at,
      itemCount: r.item_count,
      containsTitle: r.contains === null ? null : r.contains === 1,
      covers: covers.get(r.id) ?? [],
    })),
  };
};

/** Itens da lista em ordem de exibição, paginados. null = lista inexistente. */
export const getListPage = (db: Database, listId: string, opts: { limit: number; offset: number }): { items: ListItemView[]; total: number } | null => {
  if (!getListRow(db, listId)) return null;
  const total = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?').get(listId)?.n ?? 0;
  const rows = db
    .query<
      {
        title_id: string;
        position: number;
        added_at: string;
        t_source: TitleSource;
        t_source_id: string;
        t_media_type: MediaType;
        t_title: string;
        t_poster_path: string | null;
        t_release_date: string | null;
        t_vote_average: number | null;
      },
      [string, number, number]
    >(
      `SELECT li.title_id, li.position, li.added_at,
         t.source AS t_source, t.source_id AS t_source_id, t.media_type AS t_media_type, t.title AS t_title,
         t.poster_path AS t_poster_path, t.release_date AS t_release_date, t.vote_average AS t_vote_average
       FROM list_items li JOIN titles t ON t.id = li.title_id
       WHERE li.list_id = ? ORDER BY li.position, li.added_at, li.title_id LIMIT ? OFFSET ?`,
    )
    .all(listId, opts.limit, opts.offset);
  return {
    total,
    items: rows.map((r) => ({
      titleId: r.title_id,
      position: r.position,
      addedAt: r.added_at,
      title: {
        source: r.t_source,
        sourceId: r.t_source_id,
        mediaType: r.t_media_type,
        title: r.t_title,
        posterPath: r.t_poster_path,
        releaseDate: r.t_release_date,
        voteAverage: r.t_vote_average,
      },
    })),
  };
};

/**
 * Acrescenta títulos ao fim, numa transação: título inexistente ou teto estourado recusa o lote inteiro.
 * Já presentes contam como `existing` e não mudam de posição (adicionar de novo é idempotente).
 * null = lista inexistente.
 */
export const addTitlesToList = (db: Database, listId: string, titleIds: string[]): { added: number; existing: number } | null =>
  db.transaction((): { added: number; existing: number } | null => {
    if (!getListRow(db, listId)) return null;

    const known = new Set<string>();
    for (const batch of chunks(titleIds)) {
      for (const r of db.query<{ id: string }, string[]>(`SELECT id FROM titles WHERE id IN (${marks(batch.length)})`).all(...batch)) known.add(r.id);
    }
    if (known.size !== new Set(titleIds).size) throw new ValidationError('há títulos que não existem no catálogo local');

    const present = new Set<string>();
    for (const batch of chunks(titleIds)) {
      for (const r of db
        .query<{ title_id: string }, string[]>(`SELECT title_id FROM list_items WHERE list_id = ? AND title_id IN (${marks(batch.length)})`)
        .all(listId, ...batch)) present.add(r.title_id);
    }
    const fresh = titleIds.filter((id) => !present.has(id));
    const count = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?').get(listId)?.n ?? 0;
    if (count + fresh.length > LIST_ITEMS_MAX) throw new ValidationError(`a lista não pode passar de ${LIST_ITEMS_MAX} itens`);

    const at = new Date().toISOString();
    const start = db.query<{ p: number }, [string]>('SELECT COALESCE(MAX(position), -1) AS p FROM list_items WHERE list_id = ?').get(listId)?.p ?? -1;
    const insert = db.query('INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, ?, ?)');
    for (const [i, titleId] of fresh.entries()) insert.run(listId, titleId, start + 1 + i, at);
    if (fresh.length > 0) db.query('UPDATE lists SET updated_at = ? WHERE id = ?').run(at, listId);
    return { added: fresh.length, existing: present.size };
  })();

export const removeTitleFromList = (db: Database, listId: string, titleId: string): boolean => {
  const removed = db.query('DELETE FROM list_items WHERE list_id = ? AND title_id = ?').run(listId, titleId).changes > 0;
  if (removed) db.query('UPDATE lists SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), listId);
  return removed;
};

/**
 * Grava a ordem enviada (posições 0..n-1) numa transação. Recusa qualquer ordem que não seja uma permutação exata
 * da lista atual. null = lista inexistente.
 */
export const reorderList = (db: Database, listId: string, titleIds: string[]): string[] | null =>
  db.transaction((): string[] | null => {
    if (!getListRow(db, listId)) return null;
    const rows = db
      .query<{ title_id: string; position: number; added_at: string }, [string]>('SELECT title_id, position, added_at FROM list_items WHERE list_id = ?')
      .all(listId);
    const current = orderByPosition(rows.map((r) => ({ titleId: r.title_id, position: r.position, addedAt: r.added_at })));
    const problem = checkPermutation(current, titleIds);
    if (problem) throw new ValidationError(problem);

    const update = db.query('UPDATE list_items SET position = ? WHERE list_id = ? AND title_id = ?');
    for (const [i, titleId] of titleIds.entries()) update.run(i, listId, titleId);
    db.query('UPDATE lists SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), listId);
    return [...titleIds];
  })();

/** Nomes das listas de cada título (para a coluna "lists" do CSV), em ordem alfabética sem diferenciar maiúsculas. */
export const listNamesByTitle = (db: Database): Map<string, string[]> => {
  const names = new Map<string, string[]>();
  for (const r of db
    .query<{ title_id: string; name: string }, []>(
      'SELECT li.title_id, l.name FROM list_items li JOIN lists l ON l.id = li.list_id ORDER BY l.name COLLATE NOCASE, l.id',
    )
    .all()) {
    const list = names.get(r.title_id) ?? [];
    list.push(r.name);
    names.set(r.title_id, list);
  }
  return names;
};
