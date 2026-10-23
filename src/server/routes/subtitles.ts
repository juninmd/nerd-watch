import { Hono } from 'hono';
import { config } from '../config.ts';
import { OpenSubtitlesNotConfiguredError, OpenSubtitlesRequestError, openSubtitlesEnabled } from '../providers/opensubtitles.ts';
import { resolveAddonFileUrl, resolveSubtitleDownload, searchAllSubtitles } from '../providers/subtitles/index.ts';
import { fetchSubtitleBytes } from '../subtitles/load.ts';
import type { MediaType } from '../types.ts';
import { subtitleFailureText, subtitleVttHandler } from './subtitles-vtt.ts';

export const subtitlesRoutes = new Hono();

/** Legenda já convertida para WebVTT, pronta para o `<track>` do player. */
subtitlesRoutes.post('/vtt', subtitleVttHandler);

/** Id do IMDb é `tt` + dígitos. Validar aqui evita que um valor cru chegue ao nome do arquivo. */
const IMDB_ID_RE = /^tt\d{7,10}$/;

const parseMediaType = (raw: string | undefined): MediaType | undefined => (raw === 'tv' ? 'tv' : raw === 'movie' ? 'movie' : undefined);

const parseNumber = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * Busca agregada.
 *
 * `enabled: false` vem com `reason` — e a interface diz uma coisa diferente em cada caso, porque
 * "nenhuma fonte configurada" e "não conseguimos o id do IMDb" pedem ações diferentes do usuário.
 */
subtitlesRoutes.get('/', async (c) => {
  const query = c.req.query('query')?.trim() || undefined;
  const tmdbId = parseNumber(c.req.query('tmdbId'));
  const mediaType = parseMediaType(c.req.query('mediaType'));
  const imdbIdRaw = c.req.query('imdbId')?.trim() || undefined;
  const imdbId = imdbIdRaw && IMDB_ID_RE.test(imdbIdRaw) ? imdbIdRaw : undefined;
  const season = parseNumber(c.req.query('season')) ?? null;
  const episode = parseNumber(c.req.query('episode')) ?? null;

  if (!query && !tmdbId && !imdbId) return c.json({ error: 'informe "tmdbId", "imdbId" ou "query"' }, 400);

  try {
    const outcome = await searchAllSubtitles({ query, tmdbId, mediaType, imdbId, season, episode });
    return c.json({
      enabled: outcome.enabled,
      reason: outcome.reason,
      imdbId: outcome.imdbId,
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

  const imdbIdRaw = typeof body.imdbId === 'string' ? body.imdbId : '';
  try {
    const resolved = await resolveSubtitleDownload({
      source,
      id,
      imdbId: IMDB_ID_RE.test(imdbIdRaw) ? imdbIdRaw : undefined,
      tmdbId: Number.isInteger(body.tmdbId) ? (body.tmdbId as number) : undefined,
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
 * consulta ao addon — nunca de um parâmetro do cliente. A URL que o addon devolve ainda passa por
 * `isFetchableSubtitleUrl` (só http(s), nunca host privado) e é conferida de novo depois do fetch,
 * porque o addon é código de terceiro: sem isso ele poderia apontar para `file://` ou loopback.
 */
subtitlesRoutes.get('/file', async (c) => {
  const source = c.req.query('source') ?? '';
  const id = c.req.query('id') ?? '';
  const imdbId = c.req.query('imdbId') ?? '';
  const type = c.req.query('type') === 'series' ? 'series' : 'movie';
  const season = parseNumber(c.req.query('season')) ?? null;
  const episode = parseNumber(c.req.query('episode')) ?? null;

  if (!config.subtitles.addons.includes(source)) return c.json({ error: 'fonte de legenda não configurada' }, 403);
  if (!id || !IMDB_ID_RE.test(imdbId)) return c.json({ error: 'parâmetros incompletos ou inválidos' }, 400);

  const resolved = await resolveAddonFileUrl({ source, id, imdbId, type, season, episode });
  if (!resolved.ok) {
    if (resolved.reason === 'not_found') return c.json({ error: 'legenda não encontrada na fonte' }, 404);
    if (resolved.reason === 'untrusted_url') return c.json({ error: 'a fonte devolveu um endereço não permitido' }, 502);
    return c.json({ error: 'a fonte de legendas não respondeu' }, 502);
  }

  // Redirecionamento é seguido com checagem de host em cada salto (ver fetchSubtitleBytes).
  const got = await fetchSubtitleBytes(resolved.url);
  if (!got.ok) return c.json({ error: subtitleFailureText(got.reason) }, 502);

  // `imdbId` já foi validado contra `IMDB_ID_RE`, então isto não é texto livre do cliente.
  const filename = `${imdbId}${season && episode ? `.S${season}E${episode}` : ''}.srt`;
  return new Response(got.bytes.slice(), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
