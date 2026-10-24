import type { StatsSummary } from '../../server/stats/summary.ts';

/**
 * Do resumo da API para o que a tela e o cartão mostram. Puro (sem DOM), então o texto em pt-BR e os números
 * são testáveis. Nenhum título entra aqui: só agregados.
 */

export const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const MONTH_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAY_LONG = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

const nf = (digits = 0): Intl.NumberFormat => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits });

export const formatCount = (n: number): string => nf().format(n);
export const formatHours = (h: number): string => `${nf(1).format(h)} h`;

/** `AAAA-MM-DD` → `DD/MM/AAAA`, sem passar por Date (sem deslocamento de fuso). */
export const formatDateBr = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export interface Kpi {
  id: string;
  label: string;
  value: string;
  hint: string;
}

const watchHint = (missing: number, known: number): string => {
  if (missing > 0)
    return `${formatCount(missing)} ${plural(missing, 'exibição sem duração', 'exibições sem duração')} de fora`;
  return known > 0 ? 'estimativa pela duração do catálogo' : 'sem duração no catálogo ainda';
};

/** Cartões de destaque do ano. Vazios viram "—" com dica, nunca zero enganoso. */
export const kpiCards = (s: StatsSummary): Kpi[] => {
  const p = s.period;
  const streak = p.longestStreak;
  const genre = p.genres.top[0];
  const busiest = p.busiestWeekday;
  return [
    {
      id: 'finished',
      label: 'Concluídos',
      value: formatCount(p.finished),
      hint: `${formatCount(p.rewatches)} ${plural(p.rewatches, 'revisão', 'revisões')}`,
    },
    {
      id: 'hours',
      label: 'Tempo assistido',
      value: formatHours(p.watchTime.hours),
      hint: watchHint(p.watchTime.missingViewings, p.watchTime.knownViewings),
    },
    {
      id: 'days',
      label: 'Dias com atividade',
      value: formatCount(p.activeDays),
      hint: streak
        ? `maior sequência: ${formatCount(streak.days)} ${plural(streak.days, 'dia', 'dias')}`
        : 'nenhuma sequência ainda',
    },
    {
      id: 'rating',
      label: 'Nota média',
      value: p.ratings.average === null ? '—' : nf(1).format(p.ratings.average),
      hint:
        p.ratings.rated > 0
          ? `de ${formatCount(p.ratings.rated)} ${plural(p.ratings.rated, 'nota', 'notas')}`
          : 'nenhuma nota neste ano',
    },
    {
      id: 'genre',
      label: 'Gênero mais visto',
      value: genre ? genre.name : '—',
      hint: genre
        ? `${formatCount(genre.titles)} ${plural(genre.titles, 'título', 'títulos')}`
        : 'sem gêneros no catálogo',
    },
    {
      id: 'weekday',
      label: 'Dia mais movimentado',
      value: busiest === null ? '—' : (WEEKDAY_LONG[busiest] ?? '—'),
      hint: busiest === null ? 'sem atividade neste ano' : 'pelos eventos da lista',
    },
  ];
};

export interface BacklogView {
  headline: string;
  detail: string;
}

/** "Quero ver" → frase de término. Sem duração conhecida, diz isso em vez de inventar uma data. */
export const backlogView = (s: StatsSummary): BacklogView => {
  const b = s.backlog;
  if (b.titles === 0) return { headline: 'Fila vazia', detail: 'Nenhum título marcado como "quero ver".' };
  const known = b.titles - b.missingTitles;
  const missing =
    b.missingTitles > 0 ? ` ${formatCount(b.missingTitles)} sem duração no catálogo ficaram de fora.` : '';
  if (b.etaDate === null || known === 0) {
    return {
      headline: `${formatCount(b.titles)} ${plural(b.titles, 'título', 'títulos')} na fila`,
      detail: `Sem duração conhecida para estimar o término.${missing}`,
    };
  }
  return {
    headline: `Terminar até ${formatDateBr(b.etaDate)}`,
    detail: `${formatHours(b.hours)} na fila, no ritmo de ${nf(2).format(b.hoursPerDay)} h por dia.${missing}`,
  };
};

export interface Row {
  label: string;
  value: number;
  tip: string;
}

/** Um mês por linha: conclusões e revisões empilhadas, e a atividade (progresso) à parte. */
export interface MonthRow {
  label: string;
  finished: number;
  rewatches: number;
  progress: number;
  hours: number | null;
  tip: string;
  finishedTip: string;
  rewatchTip: string;
}

export const monthRows = (s: StatsSummary): MonthRow[] =>
  s.period.months.map((m, i) => {
    const name = MONTH_LONG[i] ?? '';
    const parts = [
      `${formatCount(m.finished)} ${plural(m.finished, 'conclusão', 'conclusões')}`,
      `${formatCount(m.rewatches)} ${plural(m.rewatches, 'revisão', 'revisões')}`,
      `${formatCount(m.progress)} ${plural(m.progress, 'marcação', 'marcações')}`,
    ];
    return {
      label: MONTH_SHORT[i] ?? '',
      finished: m.finished,
      rewatches: m.rewatches,
      progress: m.progress,
      hours: m.hours,
      tip: `${name}: ${parts.join(', ')}${m.hours === null ? '' : `, ${formatHours(m.hours)}`}`,
      finishedTip: `${name}: ${formatCount(m.finished)} ${plural(m.finished, 'conclusão', 'conclusões')}`,
      rewatchTip: `${name}: ${formatCount(m.rewatches)} ${plural(m.rewatches, 'revisão', 'revisões')}`,
    };
  });

export const weekdayRows = (s: StatsSummary): Row[] =>
  s.period.weekdays.map((v, i) => ({
    label: WEEKDAY_SHORT[i] ?? '',
    value: v,
    tip: `${WEEKDAY_LONG[i] ?? ''}: ${formatCount(v)} ${plural(v, 'evento', 'eventos')}`,
  }));

export const ratingRows = (s: StatsSummary): Row[] =>
  s.period.ratings.counts.map((v, i) => ({
    label: String(i),
    value: v,
    tip: `nota ${i}: ${formatCount(v)} ${plural(v, 'título', 'títulos')}`,
  }));

export const genreRows = (s: StatsSummary): Row[] =>
  s.period.genres.top.map((g) => ({
    label: g.name,
    value: g.titles,
    tip: `${g.name}: ${formatCount(g.titles)} ${plural(g.titles, 'título', 'títulos')}`,
  }));

/** Anos do seletor: do primeiro ano com histórico até o ano atual, mais recente primeiro. */
export const yearOptions = (firstYear: number | null, currentYear: number): number[] => {
  const first = firstYear === null ? currentYear : Math.min(firstYear, currentYear);
  const years: number[] = [];
  for (let y = currentYear; y >= first; y--) years.push(y);
  return years;
};
