import type { StatsSummary } from '../../server/stats/summary.ts';
import { formatCount, formatHours, plural } from './model.ts';

/**
 * Conteúdo do cartão "Meu ano" (Year in Review). Só agregados: nenhum título, nenhuma anotação e nenhuma data
 * de evento individual. O PNG é desenhado no navegador a partir deste modelo (ver share-card.ts), sem upload.
 */
export interface ShareTile {
  label: string;
  value: string;
}

export interface ShareCardModel {
  year: number;
  headline: string;
  tiles: ShareTile[];
  /** Conclusões + revisões por mês (12 valores, janeiro primeiro). */
  months: number[];
  footer: string;
}

export const shareCardModel = (s: StatsSummary): ShareCardModel => {
  const p = s.period;
  const headline =
    p.finished > 0
      ? `${formatCount(p.finished)} ${plural(p.finished, 'título concluído', 'títulos concluídos')} em ${s.year}`
      : `Ainda sem conclusões em ${s.year}`;
  const streak = p.longestStreak;
  const tiles: ShareTile[] = [
    { label: 'Tempo assistido', value: formatHours(p.watchTime.hours) },
    { label: 'Revisões', value: formatCount(p.rewatches) },
    { label: 'Dias com atividade', value: formatCount(p.activeDays) },
    {
      label: 'Maior sequência',
      value: streak ? `${formatCount(streak.days)} ${plural(streak.days, 'dia', 'dias')}` : '—',
    },
    {
      label: 'Nota média',
      value: p.ratings.average === null ? '—' : p.ratings.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 }),
    },
    { label: 'Gênero mais visto', value: p.genres.top[0]?.name ?? '—' },
  ];
  return {
    year: s.year,
    headline,
    tiles,
    months: p.months.map((m) => m.finished + m.rewatches),
    footer: 'nerd-watch · dados só no seu aparelho',
  };
};
