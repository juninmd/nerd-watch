/** Marcador de progresso ("onde parei"): temporada e episódio do último visto. */
export interface EpisodeMarker {
  season: number;
  episode: number;
}

/**
 * Espelha a regra da consulta de "próximos episódios" no servidor (`UP_NEXT_SQL`): os especiais
 * (temporada 0) são uma trilha própria, então só andam entre si.
 */
export const isEpisodeWatched = (marker: EpisodeMarker | null, season: number, episode: number): boolean => {
  if (!marker) return false;
  if (season === 0 || marker.season === 0) return season === marker.season && episode <= marker.episode;
  return season < marker.season || (season === marker.season && episode <= marker.episode);
};
