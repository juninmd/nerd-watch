import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { loadStatsInputs } from '../repo/stats.ts';
import { isStatsError, parseStatsParams } from '../stats/params.ts';
import { buildSummary } from '../stats/summary.ts';
import { todayLocal } from '../stats/time.ts';

export const statsRoutes = new Hono();

/**
 * Estatísticas de um ano (`year`), no fuso do navegador (`tz`, IANA) e com o ritmo da fila (`hpd`, horas por dia).
 * Só agregados: nenhuma anotação ou título sai daqui além do que a tela já mostra.
 */
statsRoutes.get('/', async (c) => {
  const now = new Date();
  const params = parseStatsParams({ year: c.req.query('year'), tz: c.req.query('tz'), hpd: c.req.query('hpd') }, now);
  if (isStatsError(params)) return c.json(params, 400);

  const inputs = loadStatsInputs(await getDb(), params.year);
  return c.json(
    buildSummary({
      year: params.year,
      timeZone: params.timeZone,
      today: todayLocal(now, params.timeZone),
      hoursPerDay: params.hoursPerDay,
      ...inputs,
    }),
  );
});
