import { Hono } from 'hono';
import { getDb } from '../db/database.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';
import { relinkLibraryEntry } from '../repo/library-relink.ts';
import { refreshAllChannelLinks } from '../repo/telegram-links.ts';
import { parseCatalogTitle, TITLE_INPUT_ERROR, upsertCatalogTitle } from './library-title-input.ts';

export const libraryRelinkRoutes = new Hono();

const MESSAGES = {
  not_found: 'título não está na lista',
  same: 'esse já é o título vinculado',
  conflict: 'o título escolhido já está na sua lista; remova um dos dois antes',
} as const;

/** "Vínculo errado?": troca o título de uma entrada da biblioteca pelo escolhido na busca, levando tudo junto. */
libraryRelinkRoutes.post('/:titleId/relink', (c) =>
  guardInput(c, async () => {
    const input = parseCatalogTitle(await readJsonObject(c, 32 * 1024));
    if (!input) return c.json({ error: TITLE_INPUT_ERROR }, 400);
    const db = await getDb();
    const target = upsertCatalogTitle(db, input);
    const outcome = relinkLibraryEntry(db, c.req.param('titleId'), target.id);
    if (!outcome.ok) return c.json({ error: MESSAGES[outcome.reason] }, outcome.reason === 'not_found' ? 404 : 409);
    refreshAllChannelLinks(db);
    return c.json({ titleId: target.id, source: target.source, sourceId: target.source_id, mediaType: target.media_type });
  }),
);
