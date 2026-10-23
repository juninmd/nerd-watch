import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { InvalidPlaybackError, deletePlaybackEntry, listPlaybackEntries, parsePlaybackEntry, parsePlaybackKey, upsertPlaybackEntry } from '../repo/playback.ts';
import { advanceLinkedProgress, isPlayed, type LinkedProgress } from '../repo/telegram-link-progress.ts';

export const playbackRoutes = new Hono();

const toProgressDto = (p: LinkedProgress) => ({
  titleId: p.titleId,
  seasonNumber: p.seasonNumber,
  episodeNumber: p.episodeNumber,
  changed: p.changed,
  previous: p.previous,
  entryId: p.entryId,
});

const MAX_BODY_BYTES = 8 * 1024;
const MAX_PAGE = 500;

/** Lê o corpo até um teto: sem isso um PUT gigante (sem Content-Length) ficaria inteiro na memória. */
const readLimited = async (req: Request): Promise<string | null> => {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const intParam = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

playbackRoutes.get('/', async (c) => {
  const limit = intParam(c.req.query('limit'), MAX_PAGE, 1, MAX_PAGE);
  const offset = intParam(c.req.query('offset'), 0, 0, 1_000_000);
  return c.json({ entries: listPlaybackEntries(await getDb(), limit, offset), limit, offset });
});

playbackRoutes.put('/:key', async (c) => {
  const text = await readLimited(c.req.raw);
  if (text === null) return c.json({ error: 'corpo grande demais' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: 'corpo inválido: esperado JSON' }, 400);
  }
  try {
    const entry = parsePlaybackEntry(c.req.param('key'), body);
    const db = await getDb();
    const applied = upsertPlaybackEntry(db, entry);
    // Vídeo de canal vinculado a um episódio: ao atingir o limiar, "Onde parei" avança (e o cliente pode desfazer).
    const linked = applied && entry.meta && isPlayed(entry.seconds, entry.duration, entry.done) ? advanceLinkedProgress(db, entry.meta.channelId, entry.meta.messageId) : null;
    // `progress` só aparece quando um vídeo vinculado avançou: o formato antigo ({ applied }) continua igual.
    return c.json(linked ? { applied, progress: toProgressDto(linked) } : { applied });
  } catch (err) {
    if (err instanceof InvalidPlaybackError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

playbackRoutes.delete('/:key', async (c) => {
  try {
    const key = parsePlaybackKey(c.req.param('key'));
    return c.json({ deleted: deletePlaybackEntry(await getDb(), key) });
  } catch (err) {
    if (err instanceof InvalidPlaybackError) return c.json({ error: err.message }, 400);
    throw err;
  }
});
