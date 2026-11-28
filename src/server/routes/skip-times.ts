import { Hono } from 'hono';
import { guardInput } from '../http/json-body.ts';
import { hasControlChar } from '../lib/text-guards.ts';
import { ValidationError } from '../lib/validation-error.ts';
import { skipSegments } from '../providers/skip-times/index.ts';
import { tmdbExternalIds } from '../providers/tmdb.ts';

export const skipTimesRoutes = new Hono();

const IMDB = /^tt\d{5,10}$/;
const small = (v: string | undefined, max: number): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ValidationError('número fora do intervalo');
  return n;
};

/** Trechos de abertura, recapitulação e créditos de um episódio ou filme (IntroDB e AniSkip, sem chave). */
skipTimesRoutes.get('/', (c) =>
  guardInput(c, async () => {
    const rawImdb = c.req.query('imdbId') ?? null;
    if (rawImdb !== null && !IMDB.test(rawImdb)) throw new ValidationError('imdbId inválido');
    // Ficha da TMDB não tem o IMDb na mão: o servidor resolve (cache de 24 h), como na busca de streams.
    const tmdbId = small(c.req.query('tmdbId'), 99_999_999);
    const mediaType = c.req.query('mediaType') === 'movie' ? 'movie' : 'tv';
    const imdbId = rawImdb ?? (tmdbId ? await tmdbExternalIds(mediaType, tmdbId).catch(() => null) : null);
    const title = c.req.query('title')?.trim() || null;
    if (title !== null && (title.length > 200 || hasControlChar(title))) throw new ValidationError('title inválido');
    if (!imdbId && !title) throw new ValidationError('informe imdbId ou title');
    const segments = await skipSegments({
      imdbId,
      season: small(c.req.query('season'), 999),
      episode: small(c.req.query('episode'), 9999),
      title,
      duration: small(c.req.query('duration'), 24 * 3600),
    });
    return c.json({ segments });
  }),
);
