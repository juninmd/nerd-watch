import { type EpisodeMarker, isEpisodeWatched } from '../library/episode-progress.ts';

/** Episódio no formato comum das fichas (TMDB e TVmaze): a tela de episódios não sabe de onde veio. */
export interface EpisodeView {
  season: number;
  number: number;
  name: string;
  airDate: string | null;
  runtime: number | null;
  overview: string | null;
  stillUrl: string | null;
  rating: number | null;
  /** Selo extra (ex.: "especial"); `null` no episódio comum. */
  tag?: string | null;
}

export type EpisodeSort = 'number' | 'rating' | 'recent';
export type EpisodeLayout = 'grid' | 'list';

export interface EpisodeFilter {
  query: string;
  onlyUnseen: boolean;
  sort: EpisodeSort;
}

export type EpisodeState = 'current' | 'watched' | 'unseen';

/** Busca sem acento e sem caixa: "cafe" acha "Café". */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const episodeState = (marker: EpisodeMarker | null, ep: Pick<EpisodeView, 'season' | 'number'>): EpisodeState => {
  if (marker?.season === ep.season && marker.episode === ep.number) return 'current';
  return isEpisodeWatched(marker, ep.season, ep.number) ? 'watched' : 'unseen';
};

/** Aplica busca (número, nome ou sinopse), "só não vistos" e ordem. Não altera a lista recebida. */
export const filterEpisodes = (episodes: EpisodeView[], filter: EpisodeFilter, marker: EpisodeMarker | null): EpisodeView[] => {
  const q = fold(filter.query.trim());
  const out = episodes.filter((ep) => {
    if (filter.onlyUnseen && episodeState(marker, ep) === 'watched') return false;
    if (!q) return true;
    return String(ep.number) === q || fold(ep.name).includes(q) || fold(ep.overview ?? '').includes(q);
  });
  if (filter.sort === 'rating') return out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.number - b.number);
  if (filter.sort === 'recent') return out.sort((a, b) => b.number - a.number);
  return out.sort((a, b) => a.number - b.number);
};

/** Quantos episódios vão até o marcador (inclusive) e o total, para o anel de progresso. */
export const progressFromMarker = (seasons: Array<{ number: number; count: number }>, marker: EpisodeMarker | null): { watched: number; total: number } => {
  let watched = 0;
  let total = 0;
  for (const s of seasons) {
    if (s.number <= 0) continue;
    total += s.count;
    if (!marker) continue;
    if (s.number < marker.season) watched += s.count;
    else if (s.number === marker.season) watched += Math.min(s.count, Math.max(0, marker.episode));
  }
  return { watched, total };
};

/** `T2 · E07`: código curto usado nos cartões e no modal. */
export const episodeCode = (ep: Pick<EpisodeView, 'season' | 'number'>): string => `T${ep.season} · E${String(ep.number).padStart(2, '0')}`;
