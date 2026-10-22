import type { WatchStatus } from '../../types.ts';
import type { SeasonMap } from './watched.ts';

export interface Episode {
  season: number;
  episode: number;
}

/** Estado atual da entrada na lista do app (null quando o título ainda não está na lista). */
export interface CurrentEntry {
  status: WatchStatus;
  season: number | null;
  episode: number | null;
}

/** O que gravar. `null` no plano = nada a fazer (idempotência). */
export interface ImportPlan {
  watchStatus: WatchStatus;
  /** Só presente quando o ponteiro avança; ausente = manter o que está salvo. */
  pointer?: Episode;
}

/** Status que o import nunca mexe: `dropped` é decisão explícita do usuário; `watched` já é o mais avançado. */
const FROZEN: WatchStatus[] = ['watched', 'dropped'];
export const isFrozen = (status: WatchStatus): boolean => FROZEN.includes(status);

const isAfter = (a: Episode, b: Episode): boolean => a.season > b.season || (a.season === b.season && a.episode > b.episode);

/** Último episódio visto em temporada regular (a 0, especiais, não conta para o ponteiro). */
export const lastWatched = (seasons: SeasonMap): Episode | null => {
  let last: Episode | null = null;
  for (const [season, episodes] of seasons) {
    if (season < 1) continue;
    for (const episode of episodes) {
      const candidate = { season, episode };
      if (!last || isAfter(candidate, last)) last = candidate;
    }
  }
  return last;
};

/**
 * A série está completa só se, para cada temporada regular que a TMDB conhece, todos os episódios de 1 a N foram vistos.
 * Sem dado da TMDB (ou sem temporadas) não dá para afirmar: devolve false e o import fica no conservador `watching`.
 */
export const isSeriesComplete = (seasons: SeasonMap, tmdbSeasons: Array<{ seasonNumber: number; episodeCount: number }>): boolean => {
  const required = tmdbSeasons.filter((s) => s.seasonNumber >= 1 && s.episodeCount > 0);
  if (required.length === 0) return false;
  return required.every((s) => {
    const watched = seasons.get(s.seasonNumber);
    if (!watched) return false;
    for (let episode = 1; episode <= s.episodeCount; episode++) if (!watched.has(episode)) return false;
    return true;
  });
};

const advancePointer = (current: CurrentEntry | null, last: Episode): Episode | undefined => {
  if (!current || current.season === null || current.episode === null) return last;
  return isAfter(last, { season: current.season, episode: current.episode }) ? last : undefined;
};

export const planMovie = (current: CurrentEntry | null): ImportPlan | null => {
  if (current && isFrozen(current.status)) return null;
  return { watchStatus: 'watched' };
};

export const planShow = (current: CurrentEntry | null, seasons: SeasonMap, complete: boolean): ImportPlan | null => {
  const last = lastWatched(seasons);
  if (!last) return null; // só especiais: nada que avance a lista
  if (current && isFrozen(current.status)) return null;
  const watchStatus: WatchStatus = complete ? 'watched' : 'watching';
  const pointer = advancePointer(current, last);
  if (current && current.status === watchStatus && pointer === undefined) return null;
  return pointer ? { watchStatus, pointer } : { watchStatus };
};
