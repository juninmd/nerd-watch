import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { LIST_BULK_MAX, LIST_ITEMS_MAX, readTitleIds, validateDescription, validateListName, validateTitleIds } from '../lists/rules.ts';
import {
  addTitlesToList,
  createList,
  deleteList,
  getListPage,
  getListRow,
  listSummaries,
  removeTitleFromList,
  reorderList,
  updateList,
  type ListItemView,
  type ListRow,
  type ListSummary,
} from '../repo/lists.ts';
import { posterUrl } from './library.ts';
import { assertKnownKeys, guardInput, parsePage, readJsonObject } from './json-body.ts';

/** Listas próprias (locais). Montado em /api/lists. */
export const listsRoutes = new Hono();

const LIST_FIELDS = ['name', 'description'] as const;

const listDto = (row: ListRow, extra: { itemCount: number; containsTitle: boolean | null; covers?: ListSummary['covers'] }) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  itemCount: extra.itemCount,
  containsTitle: extra.containsTitle,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  covers: (extra.covers ?? []).map((c) => ({ posterUrl: posterUrl(c.source, c.posterPath) })),
});

const itemDto = (item: ListItemView) => ({
  titleId: item.titleId,
  position: item.position,
  addedAt: item.addedAt,
  title: {
    sourceId: item.title.sourceId,
    source: item.title.source,
    mediaType: item.title.mediaType,
    title: item.title.title,
    posterUrl: posterUrl(item.title.source, item.title.posterPath),
    releaseDate: item.title.releaseDate,
    voteAverage: item.title.voteAverage,
  },
});

listsRoutes.get('/', (c) =>
  guardInput(c, async () => {
    const { limit, offset } = parsePage(c.req.query('limit'), c.req.query('offset'), 100, 50);
    const titleId = c.req.query('titleId');
    if (titleId !== undefined && (titleId === '' || titleId.length > 64)) return c.json({ error: 'titleId inválido' }, 400);
    const page = listSummaries(await getDb(), { limit, offset, containsTitleId: titleId ?? null });
    return c.json({
      items: page.items.map((s) => listDto(s, { itemCount: s.itemCount, containsTitle: s.containsTitle, covers: s.covers })),
      total: page.total,
      limit,
      offset,
    });
  }),
);

listsRoutes.post('/', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);
    assertKnownKeys(body, LIST_FIELDS);
    const row = createList(await getDb(), { name: validateListName(body.name), description: validateDescription(body.description) });
    return c.json(listDto(row, { itemCount: 0, containsTitle: null }), 201);
  }),
);

listsRoutes.get('/:id', (c) =>
  guardInput(c, async () => {
    const { limit, offset } = parsePage(c.req.query('limit'), c.req.query('offset'), 200, 100);
    const db = await getDb();
    const id = c.req.param('id');
    const row = getListRow(db, id);
    const page = getListPage(db, id, { limit, offset });
    if (!row || !page) return c.json({ error: 'lista não encontrada' }, 404);
    return c.json({ list: listDto(row, { itemCount: page.total, containsTitle: null }), items: page.items.map(itemDto), total: page.total, limit, offset });
  }),
);

listsRoutes.patch('/:id', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);
    assertKnownKeys(body, LIST_FIELDS);
    const patch: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) patch.name = validateListName(body.name);
    if (body.description !== undefined) patch.description = validateDescription(body.description);
    const db = await getDb();
    const row = updateList(db, c.req.param('id'), patch);
    if (!row) return c.json({ error: 'lista não encontrada' }, 404);
    const count = getListPage(db, row.id, { limit: 1, offset: 0 })?.total ?? 0;
    return c.json(listDto(row, { itemCount: count, containsTitle: null }));
  }),
);

listsRoutes.delete('/:id', async (c) => {
  if (!deleteList(await getDb(), c.req.param('id'))) return c.json({ error: 'lista não encontrada' }, 404);
  return c.body(null, 204);
});

/** Adiciona títulos em lote. Idempotente: quem já está na lista só conta em `existing`. */
listsRoutes.post('/:id/items', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c, 64 * 1024);
    assertKnownKeys(body, ['titleIds']);
    const result = addTitlesToList(await getDb(), c.req.param('id'), validateTitleIds(body.titleIds, LIST_BULK_MAX));
    if (!result) return c.json({ error: 'lista não encontrada' }, 404);
    return c.json(result);
  }),
);

listsRoutes.delete('/:id/items/:titleId', async (c) => {
  const db = await getDb();
  const listId = c.req.param('id');
  if (!getListRow(db, listId)) return c.json({ error: 'lista não encontrada' }, 404);
  if (!removeTitleFromList(db, listId, c.req.param('titleId'))) return c.json({ error: 'título não está na lista' }, 404);
  return c.body(null, 204);
});

/** A ordem enviada tem que ser exatamente a da lista, em outra sequência. Duplicado não é removido: é erro. */
listsRoutes.put('/:id/order', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c, 64 * 1024);
    assertKnownKeys(body, ['titleIds']);
    const ids = reorderList(await getDb(), c.req.param('id'), readTitleIds(body.titleIds, LIST_ITEMS_MAX));
    if (!ids) return c.json({ error: 'lista não encontrada' }, 404);
    return c.json({ titleIds: ids });
  }),
);
