import type { DayActivity } from '../../server/stats/period.ts';
import type { StatsSummary } from '../../server/stats/summary.ts';
import type { BarPart, HeatLayout } from './charts.ts';
import { formatCount, formatHours, MONTH_LONG, MONTH_SHORT, plural } from './model.ts';

/**
 * Visões novas das estatísticas (mapa de atividade, composição da biblioteca e meta do ano). Puro, sem DOM:
 * recebe o resumo da API e devolve o que os gráficos desenham e o texto em pt-BR.
 */

const DAY_MS = 86_400_000;

/**
 * Um quadrado por dia do ano, em colunas de semana (domingo abre) e linhas de dia da semana. O nível vai de 1 a 4
 * em quartos do dia mais movimentado: com poucos eventos o mapa ainda mostra diferença, sem escala fixa.
 */
export const heatLayout = (year: number, days: DayActivity[]): HeatLayout => {
  const counts = new Map(days.map((d) => [d.date, d.events]));
  const max = Math.max(0, ...days.map((d) => d.events));
  const start = Date.UTC(year, 0, 1);
  const total = Math.round((Date.UTC(year + 1, 0, 1) - start) / DAY_MS);
  const offset = new Date(start).getUTCDay();
  const cells: HeatLayout['cells'] = [];
  const months: HeatLayout['months'] = [];
  for (let i = 0; i < total; i++) {
    const day = new Date(start + i * DAY_MS);
    const date = day.toISOString().slice(0, 10);
    const col = Math.floor((i + offset) / 7);
    if (day.getUTCDate() === 1) months.push({ label: MONTH_SHORT[day.getUTCMonth()] ?? '', col });
    const events = counts.get(date) ?? 0;
    const when = `${day.getUTCDate()} de ${MONTH_LONG[day.getUTCMonth()] ?? ''}`;
    cells.push({
      date,
      col,
      row: (i + offset) % 7,
      level: events === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((events / max) * 4))),
      tip: `${when}: ${formatCount(events)} ${plural(events, 'evento', 'eventos')}`,
    });
  }
  return { cells, months, weeks: Math.floor((total - 1 + offset) / 7) + 1 };
};

/**
 * Cores dos status na composição da biblioteca. A ordem é fixa (assistido, assistindo, quero ver, abandonado) e
 * foi validada nessa sequência: vizinhos distinguíveis com daltonismo no fundo escuro.
 */
const STATUS_PARTS = [
  { key: 'watched', label: 'Assistido', color: '#199e70' },
  { key: 'watching', label: 'Assistindo', color: '#c98500' },
  { key: 'want', label: 'Quero ver', color: '#3987e5' },
  { key: 'dropped', label: 'Abandonado', color: '#e66767' },
] as const;

export const libraryParts = (s: StatsSummary): BarPart[] => {
  const total = s.library.total;
  return STATUS_PARTS.map((p) => {
    const value = s.library.byStatus[p.key];
    const share = total > 0 ? Math.round((value / total) * 100) : 0;
    return {
      label: p.label,
      value,
      color: p.color,
      tip: `${p.label}: ${formatCount(value)} ${plural(value, 'título', 'títulos')} (${share}%)`,
    };
  });
};

export interface GoalView {
  /** 0 a 1 para o anel; passa de 1 quando a meta foi superada (o anel satura em cheio). */
  progress: number;
  headline: string;
  detail: string;
}

const dayOfYear = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY_MS) + 1;
};

const perMonth = (n: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);

/**
 * Meta de conclusões do ano. No ano corrente compara com o ritmo esperado até hoje (meta proporcional aos dias
 * já passados); em ano passado só diz se bateu. `today` é o dia civil do navegador (`AAAA-MM-DD`).
 */
export const goalView = (finished: number, goal: number, year: number, today: string): GoalView => {
  const progress = goal > 0 ? finished / goal : 0;
  const headline = `${formatCount(finished)} de ${formatCount(goal)}`;
  const currentYear = Number(today.slice(0, 4));
  if (finished >= goal) {
    const extra = finished - goal;
    return { progress, headline, detail: extra > 0 ? `Meta batida, com ${formatCount(extra)} além dela.` : 'Meta batida.' };
  }
  const remaining = goal - finished;
  if (year < currentYear) return { progress, headline, detail: `${remaining === 1 ? 'Faltou' : 'Faltaram'} ${formatCount(remaining)} para a meta de ${year}.` };
  if (year > currentYear) return { progress, headline, detail: 'Esse ano ainda não começou.' };

  const daysInYear = dayOfYear(`${year}-12-31`);
  const expected = Math.floor((goal * dayOfYear(today)) / daysInYear);
  const monthsLeft = 12 - Number(today.slice(5, 7)) + 1;
  const pace = `faltam ${formatCount(remaining)}, cerca de ${perMonth(remaining / monthsLeft)} por mês até dezembro`;
  return {
    progress,
    headline,
    detail: finished >= expected ? `No ritmo: ${pace}.` : `Atrás do ritmo (o esperado até hoje era ${formatCount(expected)}): ${pace}.`,
  };
};

export interface YearStrip {
  year: number;
  /** Frase única para leitor de tela (a faixa inteira é um link). */
  label: string;
  items: Array<{ value: string; label: string }>;
  /** Conclusões + revisões por mês (12 posições), para o mini gráfico. */
  months: number[];
  currentMonth: number;
}

/**
 * Resumo do ano para a tela inicial. `null` quando não há nada assistido nem atividade no ano: a faixa some em
 * vez de mostrar três zeros. `currentMonth` é o mês do navegador (0 = janeiro).
 */
export const yearStrip = (s: StatsSummary, currentMonth: number): YearStrip | null => {
  const p = s.period;
  if (p.finished + p.rewatches === 0 && p.activeDays === 0) return null;
  const items = [
    { value: formatCount(p.finished), label: plural(p.finished, 'título concluído', 'títulos concluídos') },
    { value: formatHours(p.watchTime.hours), label: plural(p.watchTime.hours, 'assistida', 'assistidas') },
    { value: formatCount(p.activeDays), label: plural(p.activeDays, 'dia ativo', 'dias ativos') },
  ];
  return {
    year: s.year,
    label: `Seu ano em ${s.year}: ${items.map((i) => `${i.value} ${i.label}`).join(', ')}. Abrir estatísticas.`,
    items,
    months: p.months.map((m) => m.finished + m.rewatches),
    currentMonth,
  };
};
