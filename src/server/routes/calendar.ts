import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { listUpcoming } from '../repo/calendar.ts';
import { tmdbImageUrl } from '../providers/tmdb.ts';

export const calendarRoutes = new Hono();

calendarRoutes.get('/', async (c) => {
  const daysParam = Number(c.req.query('days') ?? '60');
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 60;

  const db = await getDb();
  const entries = listUpcoming(db, days);

  return c.json({
    days,
    entries: entries.map((e) => ({
      ...e,
      posterUrl: e.posterPath?.startsWith('http') ? e.posterPath : tmdbImageUrl(e.posterPath, 'w342'),
    })),
  });
});
