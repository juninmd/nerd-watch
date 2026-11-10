import type { StatsSummary } from '../../server/stats/summary.ts';
import { json } from './http.ts';

export interface StatsQuery {
  year: number;
  tz: string;
  hpd: number;
}

/** Resumo de estatísticas do ano (ver server/stats). O fuso e o ritmo vão na query; nada é guardado no servidor. */
export const getStats = (q: StatsQuery): Promise<StatsSummary> =>
  fetch(`/api/stats?year=${q.year}&tz=${encodeURIComponent(q.tz)}&hpd=${q.hpd}`).then((r) => json<StatsSummary>(r));
