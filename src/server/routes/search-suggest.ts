import { withCache } from '../lib/cache.ts';
import { tmdbEnabled, tmdbSearchMulti } from '../providers/tmdb.ts';
import { tvmazeSearchShows } from '../providers/tvmaze.ts';

export const SUGGEST_MAX = 8;

export interface Suggestion {
  title: string;
  year: string | null;
  mediaType: 'movie' | 'tv';
}

/** Mesmo nome e ano aparecem uma vez só (a TMDB devolve o filme e o especial com o mesmo título). */
export const uniqueSuggestions = (list: Suggestion[]): Suggestion[] => {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of list) {
    const key = `${s.title.toLowerCase()}|${s.year ?? ''}`;
    if (!s.title || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length === SUGGEST_MAX) break;
  }
  return out;
};

/** Sugestões mudam pouco e cada tecla pediria de novo: cache curto, e falha vira lista vazia. */
export const searchSuggestions = withCache(10 * 60_000, async (query: string): Promise<Suggestion[]> => {
  if (tmdbEnabled()) {
    const rows = await tmdbSearchMulti(query).catch(() => []);
    return uniqueSuggestions(
      rows
        .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
        .map((r) => ({
          title: r.title ?? r.name ?? '',
          year: (r.release_date ?? r.first_air_date ?? '').slice(0, 4) || null,
          mediaType: r.media_type as 'movie' | 'tv',
        })),
    );
  }
  const shows = await tvmazeSearchShows(query).catch(() => []);
  return uniqueSuggestions(shows.map((s) => ({ title: s.name, year: s.year ? String(s.year) : null, mediaType: 'tv' as const })));
});
