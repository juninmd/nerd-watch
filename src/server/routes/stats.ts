import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { getLibraryStats } from '../repo/stats.ts';
import { posterUrl } from './library.ts';

export const statsRoutes = new Hono();

statsRoutes.get('/', async (c) => {
  const stats = getLibraryStats(await getDb());
  return c.json({
    ...stats,
    topRated: stats.topRated.map(({ posterPath, ...r }) => ({ ...r, posterUrl: posterUrl(r.source, posterPath) })),
  });
});
