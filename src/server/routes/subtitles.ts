import { Hono } from 'hono';
import { config } from '../config.ts';
import { OpenSubtitlesNotConfiguredError, OpenSubtitlesRequestError, openSubtitlesEnabled } from '../providers/opensubtitles.ts';
import { resolveAddonFileUrl, resolveSubtitleDownload, searchAllSubtitles } from '../providers/subtitles/index.ts';
import type { MediaType } from '../types.ts';

export const subtitlesRoutes = new Hono();

const parseMediaType = (raw: string | undefined): MediaType | undefined => (raw === 'tv' ? 'tv' : raw === 'movie' ? 'movie' : undefined);

const parseNumber = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * Busca agregada. Sem `SUBTITLE_ADDONS` nem `OPENSUBTITLES_API_KEY` devolve `enabled: false`, e a
 * interface explica como ligar — em vez de parecer que o título não tem legenda.
 */
subtitlesRoutes.get('/', async (c) => {
  const query = c.req.query('query')?.trim() || undefined;
  const tmdbId = parseNumber(c.req.query('tmdbId'));
  const mediaType = parseMediaType(c.req.query('mediaType'));
  const imdbId = c.req.query('imdbId')?.trim() || undefined;
  const season = parseNumber(c.req.query('season')) ?? null;
  const episode = parseNumber(c.req.query('episode')) ?? null;

  if (!query && !tmdbId && !imdbId) return c.json({ error: 'informe "tmdbId", "imdbId" ou "query"' }, 400);

  try {
    const outcome = await searchAllSubtitles({ query, tmdbId, mediaType, imdbId, season, episode });
    return c.json({
      enabled: outcome.enabled,
      sources: outcome.sources,
      unavailable: outcome.unavailable,
      results: outcome.results,
    });
  } catch (err) {
    if (err instanceof OpenSubtitlesRequestError) return c.json({ error: err.message }, err.status === 404 ? 404 : 502);
    throw err;
  }
});

/** Legenda hospedada por addon: o cliente manda fonte + id, o servidor reencontra a URL. */
subtitlesRoutes.post('/download', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'corpo inválido' }, 400);

  const fileId = body.fileId;
  if (fileId !== undefined) {
    if (!Number.isInteger(fileId)) return c.json({ error: 'fileId inválido' }, 400);
    if (!openSubtitlesEnabled()) return c.json({ error: 'OpenSubtitles não configurado' }, 501);
    try {
      const resolved = await resolveSubtitleDownload({ fileId: fileId as number });
      if (resolved.kind !== 'link') return c.json({ error: 'não foi possível baixar essa legenda' }, 502);
      return c.json({ url: resolved.url, remaining: resolved.remaining });
    } catch (err) {
      if (err instanceof OpenSubtitlesNotConfiguredError) return c.json({ error: 'OpenSubtitles não configurado' }, 501);
      if (err instanceof OpenSubtitlesRequestError) return c.json({ error: err.message }, err.status === 406 ? 429 : 502);
      throw err;
    }
  }

  const source = typeof body.source === 'string' ? body.source : '';
  const id = typeof body.id === 'string' ? body.id : '';
  if (!source || !id) return c.json({ error: 'informe "fileId" ou "source" + "id"' }, 400);

  try {
    const resolved = await resolveSubtitleDownload({
      source,
      id,
      imdbId: typeof body.imdbId === 'string' ? body.imdbId : undefined,
      mediaType: parseMediaType(typeof body.mediaType === 'string' ? body.mediaType : undefined),
      season: Number.isInteger(body.season) ? (body.season as number) : null,
      episode: Number.isInteger(body.episode) ? (body.episode as number) : null,
    });
    if (resolved.kind === 'not_found') return c.json({ error: 'essa legenda não foi encontrada de novo na fonte' }, 404);
    if (resolved.kind === 'invalid') return c.json({ error: 'pedido de download inválido' }, 400);
    return c.json({ url: resolved.url });
  } catch (err) {
    if (err instanceof OpenSubtitlesRequestError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

/**
 * Proxy do arquivo de legenda.
 *
 * O `source` tem que estar na lista configurada (`SUBTITLE_ADDONS`), e a URL final vem de uma nova
 * consulta ao addon — nunca de um parâmetro do cliente. Sem isso isto seria um proxy aberto.
 */
subtitlesRoutes.get('/file', async (c) => {
  const source = c.req.query('source') ?? '';
  const id = c.req.query('id') ?? '';
  const imdbId = c.req.query('imdbId') ?? '';
  const type = c.req.query('type') === 'series' ? 'series' : 'movie';
  const season = parseNumber(c.req.query('season')) ?? null;
  const episode = parseNumber(c.req.query('episode')) ?? null;

  if (!config.subtitles.addons.includes(source)) return c.json({ error: 'fonte de legenda não configurada' }, 403);
  if (!id || !imdbId) return c.json({ error: 'parâmetros incompletos' }, 400);

  const url = await resolveAddonFileUrl({ source, id, imdbId, type, season, episode });
  if (!url) return c.json({ error: 'legenda não encontrada na fonte' }, 404);

  const upstream = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!upstream.ok) return c.json({ error: `a fonte respondeu ${upstream.status}` }, 502);

  const filename = `${imdbId}${season && episode ? `.S${season}E${episode}` : ''}.srt`;
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
