import { Hono } from 'hono';
import { archiveSearchPublicDomain } from '../providers/archive.ts';
import { tmdbEnabled, tmdbImageUrl, tmdbSearchMulti } from '../providers/tmdb.ts';
import type { SearchResult } from '../types.ts';

export const searchRoutes = new Hono();

searchRoutes.get('/', async (c) => {
  const query = c.req.query('q')?.trim() ?? '';
  if (!query) return c.json({ error: 'parâmetro "q" é obrigatório' }, 400);

  const [tmdbResults, archiveResults] = await Promise.all([
    tmdbEnabled()
      ? tmdbSearchMulti(query).catch(() => [] as Awaited<ReturnType<typeof tmdbSearchMulti>>)
      : Promise.resolve([]),
    archiveSearchPublicDomain(query, 12).catch(() => []),
  ]);

  const mapped: SearchResult[] = [
    ...tmdbResults.map(
      (r): SearchResult => ({
        source: 'tmdb',
        sourceId: String(r.id),
        mediaType: r.media_type as 'movie' | 'tv',
        title: r.title ?? r.name ?? '(sem título)',
        overview: r.overview,
        posterUrl: tmdbImageUrl(r.poster_path, 'w342'),
        releaseDate: r.release_date ?? r.first_air_date ?? null,
        voteAverage: r.vote_average,
      }),
    ),
    ...archiveResults.map(
      (m): SearchResult => ({
        source: 'archive',
        sourceId: m.identifier,
        mediaType: 'movie',
        title: m.title,
        overview: m.overview,
        posterUrl: m.thumbnailUrl,
        releaseDate: m.year ? `${m.year}-01-01` : null,
        voteAverage: null,
      }),
    ),
  ];

  return c.json({ results: mapped, tmdbEnabled: tmdbEnabled() });
});
