/** Tipos puros dos gráficos das estatísticas; o desenho vem do Sonido (StackedColumns, SegmentedBar, Heatmap…). */
import type { Tone } from '@juninmd/sonido';

export interface BarPart {
  label: string;
  value: number;
  tone: Tone;
}

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
