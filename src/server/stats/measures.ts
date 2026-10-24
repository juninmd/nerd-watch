import { dayDiff, weekdayOf } from './time.ts';

/**
 * Agregados puros sobre listas já lidas do banco (sem SQL, sem relógio): cada função recebe o que precisa e
 * devolve o resultado, então os testes cobrem regra de negócio sem banco.
 */

export interface Duration {
  /** Soma dos tempos conhecidos; `null` quando nada é conhecido (sem duração nenhuma no catálogo). */
  minutes: number | null;
  /** Episódios sem duração no catálogo (só séries): o total fica honesto mesmo quando parcial. */
  episodesWithoutRuntime: number;
}

export const UNKNOWN_DURATION: Duration = { minutes: null, episodesWithoutRuntime: 0 };

/** Minutos viram horas com uma casa decimal (a tela mostra "12,5 h"). */
export const hoursOf = (minutes: number): number => Math.round((minutes / 60) * 10) / 10;

export interface Streak {
  days: number;
  start: string;
  end: string;
}

/** Maior sequência de dias civis consecutivos. `dates` pode vir repetida e fora de ordem. */
export const longestStreak = (dates: string[]): Streak | null => {
  const unique = [...new Set(dates)].sort();
  let best: Streak | null = null;
  let runStart = 0;
  for (let i = 0; i < unique.length; i++) {
    const isLast = i === unique.length - 1;
    const breaksHere = !isLast && dayDiff(unique[i] as string, unique[i + 1] as string) !== 1;
    if (isLast || breaksHere) {
      const start = unique[runStart] as string;
      const end = unique[i] as string;
      const days = dayDiff(start, end) + 1;
      if (!best || days > best.days) best = { days, start, end };
      runStart = i + 1;
    }
  }
  return best;
};

/** Eventos por dia da semana (0 = domingo … 6 = sábado). Cada data conta uma vez por evento. */
export const weekdayCounts = (dates: string[]): number[] => {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const date of dates) {
    const day = weekdayOf(date);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
};

/** Dia com mais eventos; empate fica com o primeiro (domingo primeiro). `null` sem nenhum evento. */
export const busiestWeekday = (counts: number[]): number | null => {
  let best: number | null = null;
  let bestCount = 0;
  counts.forEach((count, day) => {
    if (count > bestCount) {
      best = day;
      bestCount = count;
    }
  });
  return best;
};

export const RATING_LEVELS = 11;

export interface RatingSummary {
  /** Contagem por nota inteira 0..10 (índice = nota). */
  counts: number[];
  average: number | null;
  rated: number;
  unrated: number;
}

/** Notas 0..10 arredondadas e limitadas; `null` conta como sem nota. Média com uma casa decimal. */
export const ratingSummary = (ratings: Array<number | null>): RatingSummary => {
  const counts = new Array<number>(RATING_LEVELS).fill(0);
  let sum = 0;
  let rated = 0;
  let unrated = 0;
  for (const raw of ratings) {
    if (raw === null || !Number.isFinite(raw)) {
      unrated++;
      continue;
    }
    const level = Math.min(10, Math.max(0, Math.round(raw)));
    counts[level] = (counts[level] ?? 0) + 1;
    sum += raw;
    rated++;
  }
  return { counts, average: rated > 0 ? Math.round((sum / rated) * 10) / 10 : null, rated, unrated };
};

export interface GenreCount {
  name: string;
  titles: number;
}

/** Top gêneros por número de títulos (cada título conta uma vez por gênero). Empate: ordem alfabética. */
export const topGenres = (titleGenres: Array<string[] | null>, limit = 10): { top: GenreCount[]; untagged: number } => {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const genres of titleGenres) {
    if (!genres || genres.length === 0) {
      untagged++;
      continue;
    }
    for (const name of new Set(genres)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .map(([name, titles]) => ({ name, titles }))
    .sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, limit);
  return { top, untagged };
};
