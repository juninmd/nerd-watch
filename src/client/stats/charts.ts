/**
 * Geometria dos gráficos que o Sonido não tem (colunas empilhadas e barra de composição). Funções puras: recebem
 * dados, devolvem escala e blocos; `stat-marks.tsx` só desenha. Colunas simples, barras, mapa de atividade e anel
 * vêm do Sonido (BarChart, Heatmap, ProgressRing).
 */

export interface StackedItem {
  label: string;
  segments: number[];
  tips: string[];
}

/** Maior valor "redondo" (1, 2 ou 5 × 10ⁿ) que cobre `value`; escala de eixo com marcas limpas. */
export const niceMax = (value: number): number => {
  if (value <= 1) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= value) return m * base;
  }
  return 10 * base;
};

/**
 * Marcas do eixo Y para contagens: sempre inteiras. Até 10 o teto é o menor par (ou 1) que cobre o valor, para o
 * meio do eixo não cair em "0,5 título"; acima disso vale `niceMax`, cujo meio já é inteiro.
 */
export const axisTicks = (value: number): number[] => {
  if (value <= 1) return [0, 1];
  if (value <= 10) {
    const max = value <= 2 ? 2 : Math.ceil(value / 2) * 2;
    return [0, max / 2, max];
  }
  const max = niceMax(value);
  return [0, max / 2, max];
};

export const formatTick = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10} mil` : String(n));

export const pct = (value: number, max: number): string => `${Math.round((value / max) * 10000) / 100}%`;

export interface StackedSegment {
  /** Índice da série (cor) no gráfico. */
  series: number;
  value: number;
  tip: string;
  /** Segmento de cima: leva a ponta arredondada. */
  cap: boolean;
}

export interface StackedColumn {
  label: string;
  /** Só segmentos com valor, da base para cima; zero não desenha nada. */
  segments: StackedSegment[];
  /** Número na ponta: só na coluna mais alta (a primeira, em empate); rótulo em tudo vira ruído. */
  capLabel: string | null;
}

export interface StackedLayout {
  ticks: number[];
  max: number;
  columns: StackedColumn[];
}

export const stackedLayout = (items: StackedItem[]): StackedLayout => {
  const totals = items.map((i) => i.segments.reduce((n, v) => n + Math.max(0, v), 0));
  const ticks = axisTicks(Math.max(0, ...totals));
  const max = ticks[ticks.length - 1] as number;
  const peak = Math.max(0, ...totals);
  const top = peak > 0 ? totals.indexOf(peak) : -1;
  const columns = items.map((item, i) => {
    const drawn = item.segments
      .map((value, series) => ({ series, value, tip: item.tips[series] ?? '', cap: false }))
      .filter((s) => s.value > 0);
    const last = drawn[drawn.length - 1];
    if (last) last.cap = true;
    return { label: item.label, segments: drawn, capLabel: i === top ? formatTick(totals[i] as number) : null };
  });
  return { ticks, max, columns };
};

export interface BarPart {
  label: string;
  value: number;
  color: string;
  tip: string;
}

/** Texto dentro de um bloco só quando cabe com folga; abaixo disso o valor fica no tooltip e na tabela. */
const SHARE_LABEL_MIN = 0.12;

/** Blocos da barra de composição: parte zerada sai (do desenho e da legenda); `text` só quando a fatia cabe. */
export const segmentBlocks = (parts: BarPart[]): Array<BarPart & { text: string }> => {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  if (total === 0) return [];
  return parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const share = p.value / total;
      return { ...p, text: share >= SHARE_LABEL_MIN ? `${Math.round(share * 100)}%` : '' };
    });
};

export interface HeatCell {
  date: string;
  /** Coluna = semana do ano (domingo abre a semana); linha = dia da semana (0 = domingo). */
  col: number;
  row: number;
  events: number;
  tip: string;
}

export interface HeatMonth {
  label: string;
  col: number;
}

export interface HeatLayout {
  cells: HeatCell[];
  months: HeatMonth[];
  weeks: number;
}
