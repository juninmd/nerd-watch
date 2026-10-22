import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { exportWatched, PartialExportError } from '../providers/trakt/export.ts';
import { importWatched } from '../providers/trakt/import.ts';
import { sourceErrorBody } from '../providers/sources/service.ts';

export const traktRoutes = new Hono();

/** Importa (Trakt -> app). Seguro: só escreve na lista local, é o botão principal. */
traktRoutes.post('/import', async (c) => {
  try {
    return c.json(await importWatched(await getDb()));
  } catch (err) {
    const { status, error } = sourceErrorBody(err);
    return c.json({ error }, status);
  }
});

/** Exporta (app -> Trakt). Escreve na conta externa: só com `{ "confirm": true }`, enviado por ação explícita. */
traktRoutes.post('/export', async (c) => {
  const body = await c.req.json<{ confirm?: unknown }>().catch(() => null);
  if (body?.confirm !== true) return c.json({ error: 'confirmação ausente: a exportação escreve na sua conta Trakt' }, 400);
  try {
    return c.json(await exportWatched(await getDb()));
  } catch (err) {
    const { status, error } = sourceErrorBody(err);
    if (err instanceof PartialExportError) return c.json({ error, partial: err.counts }, status);
    return c.json({ error }, status);
  }
});
