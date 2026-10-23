import { Hono } from 'hono';
import { buildCalendarIcs } from '../calendar-ics.ts';
import { getDb } from '../db.ts';
import { listUpcoming } from '../repo/calendar.ts';
import { tmdbImageUrl } from '../providers/tmdb.ts';

/** Janela em dias: inválido, zero, negativo ou acima de 365 cai no padrão de 60. Compartilhado pelo JSON e pelo .ics. */
export const parseCalendarDays = (raw: string | undefined): number => {
  const daysParam = Number(raw ?? '60');
  return Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 60;
};

export const calendarRoutes = new Hono();

calendarRoutes.get('/', async (c) => {
  const days = parseCalendarDays(c.req.query('days'));

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

/** Feed .ics para assinar no calendário: mesmos dados e validação de `days` do JSON. Montado em `/api` como `/api/calendar.ics`. */
export const calendarIcsRoutes = new Hono();

calendarIcsRoutes.get('/calendar.ics', async (c) => {
  const days = parseCalendarDays(c.req.query('days'));

  const db = await getDb();
  const body = buildCalendarIcs(listUpcoming(db, days), { now: new Date() });

  return c.body(body, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
});
