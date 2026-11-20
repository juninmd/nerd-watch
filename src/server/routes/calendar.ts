import { Hono } from 'hono';
import { calendarInfoFor, isDetailSource } from '../calendar/detail.ts';
import { CatalogRequestError } from '../lib/catalog-text.ts';
import { TmdbNotConfiguredError, TmdbRequestError } from '../providers/tmdb.ts';
import { discoverUpcoming } from '../calendar/discover.ts';
import { buildCalendarIcs } from '../calendar/ics.ts';
import { getDb } from '../db/database.ts';
import { listUpcoming } from '../repo/calendar.ts';
import { tmdbImageUrl } from '../providers/tmdb.ts';

/** Janela em dias: inválido, fracionário, zero, negativo ou acima de 365 cai no padrão de 60. Compartilhado pelo JSON e pelo .ics. */
export const parseCalendarDays = (raw: string | undefined): number => {
  const daysParam = Number(raw ?? '60');
  return Number.isInteger(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 60;
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

/** Estreias públicas (fora da biblioteca): preenche a Agenda quando nada está sendo acompanhado. */
calendarRoutes.get('/discover', async (c) => {
  const days = parseCalendarDays(c.req.query('days'));
  const { entries, failed } = await discoverUpcoming(days);
  return c.json({ days, entries, failed });
});

/** Ficha sob demanda de um item (trailer, onde assistir, links). Chave inválida ou fonte desconhecida é 400, nunca vai à rede. */
calendarRoutes.get('/detail', async (c) => {
  const source = c.req.query('source') ?? '';
  const id = c.req.query('id') ?? '';
  const media = c.req.query('media') === 'movie' ? 'movie' : 'tv';
  if (!isDetailSource(source) || !/^\d{1,10}$/.test(id)) return c.json({ error: 'source e id válidos são obrigatórios' }, 400);
  try {
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ info: await calendarInfoFor(source, Number(id), media) });
  } catch (err) {
    if (err instanceof CatalogRequestError) return c.json({ error: err.message }, err.status as 404 | 429 | 502);
    if (err instanceof TmdbNotConfiguredError) return c.json({ error: err.message }, 503);
    if (err instanceof TmdbRequestError) return c.json({ error: err.message }, err.status === 404 ? 404 : 502);
    throw err;
  }
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
