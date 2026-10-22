import { traktRequest } from './api.ts';

/** Episódios vistos por temporada: número da temporada -> números dos episódios. */
export type SeasonMap = Map<number, Set<number>>;

export interface WatchedMovie {
  tmdbId: number;
}

export interface WatchedShow {
  tmdbId: number;
  seasons: SeasonMap;
}

export interface WatchedLists {
  movies: WatchedMovie[];
  shows: WatchedShow[];
  /** Itens vistos no Trakt sem id TMDB: não há como casar com o app, então ficam de fora. */
  withoutTmdb: number;
}

const positiveInt = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null);

const tmdbIdOf = (media: unknown): number | null => positiveInt((media as { ids?: { tmdb?: unknown } } | null)?.ids?.tmdb);

/** Filmes de `GET /sync/watched/movies`: cada item tem `movie.ids.tmdb`. Sem id TMDB o item é contado, não inventado. */
export const parseWatchedMovies = (json: unknown): { movies: WatchedMovie[]; withoutTmdb: number } => {
  const movies: WatchedMovie[] = [];
  let withoutTmdb = 0;
  for (const entry of Array.isArray(json) ? json : []) {
    const tmdbId = tmdbIdOf((entry as { movie?: unknown })?.movie);
    if (tmdbId) movies.push({ tmdbId });
    else withoutTmdb++;
  }
  return { movies, withoutTmdb };
};

/** Séries de `GET /sync/watched/shows`: `show.ids.tmdb` e `seasons[].number` / `seasons[].episodes[].number`. */
export const parseWatchedShows = (json: unknown): { shows: WatchedShow[]; withoutTmdb: number } => {
  const shows: WatchedShow[] = [];
  let withoutTmdb = 0;
  for (const entry of Array.isArray(json) ? json : []) {
    const tmdbId = tmdbIdOf((entry as { show?: unknown })?.show);
    if (!tmdbId) {
      withoutTmdb++;
      continue;
    }
    const seasons: SeasonMap = new Map();
    const rawSeasons = (entry as { seasons?: unknown }).seasons;
    for (const season of Array.isArray(rawSeasons) ? rawSeasons : []) {
      // Temporada 0 são os especiais: entram no mapa, mas o cálculo de "completa" os ignora.
      const raw = (season as { number?: unknown })?.number;
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) continue;
      const number = raw;
      const episodes = new Set<number>();
      for (const ep of Array.isArray((season as { episodes?: unknown }).episodes) ? (season as { episodes: unknown[] }).episodes : []) {
        const n = positiveInt((ep as { number?: unknown })?.number);
        if (n) episodes.add(n);
      }
      if (episodes.size) seasons.set(number, episodes);
    }
    shows.push({ tmdbId, seasons });
  }
  return { shows, withoutTmdb };
};

/** Lê as duas listas do que foi assistido. `GET /sync/watched/*` devolve a lista inteira (sem paginação documentada). */
export const fetchWatchedLists = async (): Promise<WatchedLists> => {
  const [movieJson, showJson] = await Promise.all([traktRequest('GET', '/sync/watched/movies'), traktRequest('GET', '/sync/watched/shows')]);
  const movieResult = parseWatchedMovies(movieJson);
  const showResult = parseWatchedShows(showJson);
  return { movies: movieResult.movies, shows: showResult.shows, withoutTmdb: movieResult.withoutTmdb + showResult.withoutTmdb };
};
