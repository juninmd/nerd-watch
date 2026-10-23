import type { Context } from 'hono';
import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { CSV_MAX_BYTES, InputError, MAL_MAX_BYTES, readBodyText } from '../providers/library-io/common.ts';
import { importLibraryCsv, type LibraryImportReport } from '../providers/library-io/import-csv.ts';
import { importMalAnimeList, type MalImportReport } from '../providers/library-io/import-mal.ts';
import { exportLibraryCsv } from '../providers/library-io/library-csv.ts';
import { listLibrary } from '../repo/library.ts';

/** CSV e MAL da biblioteca. Montado em /api/library junto com as rotas de lista. */
export const libraryIoRoutes = new Hono();

libraryIoRoutes.get('/export.csv', async (c) => {
  const csv = exportLibraryCsv(listLibrary(await getDb()));
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="nerd-watch-biblioteca.csv"',
    'Cache-Control': 'no-store',
  });
});

/** Erro de entrada vira 400/413 com a mensagem; o resto é falha interna e segue para o handler padrão. */
const answer = async <T>(c: Context, run: () => Promise<T> | T) => {
  try {
    return c.json(await run());
  } catch (err) {
    if (err instanceof InputError) return c.json({ error: err.message }, err.status);
    throw err;
  }
};

libraryIoRoutes.post('/import.csv', (c) =>
  answer<LibraryImportReport>(c, async () => importLibraryCsv(await getDb(), await readBodyText(c.req.raw, CSV_MAX_BYTES))),
);

libraryIoRoutes.post('/import.mal', (c) =>
  answer<MalImportReport>(c, async () => importMalAnimeList(await getDb(), await readBodyText(c.req.raw, MAL_MAX_BYTES))),
);
