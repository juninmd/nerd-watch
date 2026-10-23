import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView } from '../repo/saved-views.ts';
import { parseViewName, parseViewQuery } from '../saved-views/schema.ts';
import { assertKnownKeys, guardInput, readJsonObject } from './json-body.ts';

/** Visões salvas da biblioteca (nome + combinação de filtro, ordem e layout). Montado em /api/views. */
export const savedViewsRoutes = new Hono();

const VIEW_FIELDS = ['name', 'query'] as const;

savedViewsRoutes.get('/', async (c) => c.json({ items: listSavedViews(await getDb()) }));

savedViewsRoutes.post('/', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);
    assertKnownKeys(body, VIEW_FIELDS);
    const view = createSavedView(await getDb(), { name: parseViewName(body.name), query: parseViewQuery(body.query) });
    return c.json(view, 201);
  }),
);

savedViewsRoutes.patch('/:id', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);
    assertKnownKeys(body, VIEW_FIELDS);
    const patch: { name?: string; query?: ReturnType<typeof parseViewQuery> } = {};
    if (body.name !== undefined) patch.name = parseViewName(body.name);
    if (body.query !== undefined) patch.query = parseViewQuery(body.query);
    const view = updateSavedView(await getDb(), c.req.param('id'), patch);
    if (!view) return c.json({ error: 'visão não encontrada' }, 404);
    return c.json(view);
  }),
);

savedViewsRoutes.delete('/:id', async (c) => {
  if (!deleteSavedView(await getDb(), c.req.param('id'))) return c.json({ error: 'visão não encontrada' }, 404);
  return c.body(null, 204);
});
