import { Hono } from 'hono';
import {
  OpenSubtitlesNotConfiguredError,
  OpenSubtitlesRequestError,
  openSubtitlesEnabled,
  requestSubtitleDownload,
  searchSubtitles,
} from '../providers/opensubtitles.ts';

export const subtitlesRoutes = new Hono();

subtitlesRoutes.get('/', async (c) => {
  if (!openSubtitlesEnabled()) return c.json({ enabled: false, results: [] });

  const query = c.req.query('query')?.trim() || undefined;
  const tmdbIdParam = c.req.query('tmdbId');
  const tmdbId = tmdbIdParam ? Number(tmdbIdParam) : undefined;
  if (!query && !tmdbId) return c.json({ error: 'informe "query" ou "tmdbId"' }, 400);

  try {
    const results = await searchSubtitles({ query, tmdbId });
    return c.json({ enabled: true, results });
  } catch (err) {
    if (err instanceof OpenSubtitlesNotConfiguredError) return c.json({ enabled: false, results: [] });
    if (err instanceof OpenSubtitlesRequestError) return c.json({ error: err.message }, err.status === 404 ? 404 : 502);
    throw err;
  }
});

subtitlesRoutes.post('/download', async (c) => {
  if (!openSubtitlesEnabled()) return c.json({ error: 'OpenSubtitles não configurado' }, 501);

  const body = await c.req.json<{ fileId?: number }>().catch(() => null);
  if (!body || !Number.isInteger(body.fileId)) return c.json({ error: 'fileId é obrigatório' }, 400);

  try {
    // biome-ignore lint/style/noNonNullAssertion: validado acima
    const result = await requestSubtitleDownload(body.fileId!);
    return c.json(result);
  } catch (err) {
    if (err instanceof OpenSubtitlesRequestError) return c.json({ error: err.message }, err.status === 406 ? 429 : 502);
    throw err;
  }
});
