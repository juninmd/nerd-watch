import { Hono } from 'hono';
import { getDb } from '../db/database.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { type RelinkOutcome, relinkLibraryEntry } from '../repo/library-relink.ts';
import { refreshAllChannelLinks } from '../repo/telegram-links.ts';
import { parseCatalogTitle, TITLE_INPUT_ERROR, upsertCatalogTitle } from './library-title-input.ts';

export const libraryRelinkRoutes = new Hono();

const MESSAGES = {
  not_found: 'título não está na lista',
  same: 'esse já é o título vinculado',
  conflict: 'o título escolhido já está na sua lista; remova um dos dois antes',
} as const;

type Rejection = Extract<RelinkOutcome, { ok: false }>['reason'];

/** Desfaz a gravação do título quando a troca é recusada (a transação só volta atrás com exceção). */
class RelinkRejected extends Error {
  constructor(readonly reason: Rejection) {
    super(reason);
  }
}

/** "Vínculo errado?": troca o título de uma entrada da biblioteca pelo escolhido na busca, levando tudo junto. */
libraryRelinkRoutes.post('/:titleId/relink', (c) =>
  guardInput(c, async () => {
    const input = parseCatalogTitle(await readJsonObject(c, 32 * 1024));
    if (!input) return c.json({ error: TITLE_INPUT_ERROR }, 400);
    const db = await getDb();
    const fromId = c.req.param('titleId');
    // Sem entrada de origem não grava nada: pedido recusado não deixa título órfão nem reescreve metadados.
    if (!getLibraryEntryByTitle(db, fromId)) return c.json({ error: MESSAGES.not_found }, 404);
    try {
      const target = db.transaction(() => {
        const t = upsertCatalogTitle(db, input);
        const outcome = relinkLibraryEntry(db, fromId, t.id);
        if (!outcome.ok) throw new RelinkRejected(outcome.reason);
        return t;
      })();
      refreshAllChannelLinks(db);
      return c.json({ titleId: target.id, source: target.source, sourceId: target.source_id, mediaType: target.media_type });
    } catch (err) {
      if (!(err instanceof RelinkRejected)) throw err;
      return c.json({ error: MESSAGES[err.reason] }, err.reason === 'not_found' ? 404 : 409);
    }
  }),
);
