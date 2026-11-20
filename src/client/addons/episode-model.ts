import type { AddonMetaDto } from '../api/stremio.ts';

/**
 * Navegação de episódios de um addon. Uma série do IMDb chega com todos os episódios numa lista só
 * (373 no caso de uma série longa), então a tela precisa agrupar por temporada e filtrar por nome.
 * Sem DOM: os testes cobrem ordenação, temporada ausente e busca.
 */
export type AddonVideo = AddonMetaDto['videos'][number];

export interface SeasonGroup {
  /** `null` = vídeo sem número de temporada (extra, especial, episódio solto). */
  season: number | null;
  label: string;
  episodes: AddonVideo[];
}

/** Temporada 0 é a convenção para especiais/bônus; sem número nenhum vira "Extras". */
export const seasonLabel = (season: number | null): string => (season === null ? 'Extras' : season === 0 ? 'Especiais' : `Temporada ${season}`);

/** Ordem de exibição: temporadas crescentes, com os vídeos sem temporada no fim. */
const seasonRank = (season: number | null): number => (season === null ? Number.MAX_SAFE_INTEGER : season);

const compareEpisodes = (a: AddonVideo, b: AddonVideo): number =>
  (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'pt-BR');

export const groupEpisodes = (videos: readonly AddonVideo[]): SeasonGroup[] => {
  const bySeason = new Map<number | null, AddonVideo[]>();
  for (const video of videos) {
    const key = video.season ?? null;
    const bucket = bySeason.get(key);
    if (bucket) bucket.push(video);
    else bySeason.set(key, [video]);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => seasonRank(a) - seasonRank(b))
    .map(([season, episodes]) => ({ season, label: seasonLabel(season), episodes: [...episodes].sort(compareEpisodes) }));
};

/** Busca por título ou por número do episódio (`2` casa com `E02` e com "episódio 2"); sem termo, devolve tudo. */
export const filterEpisodes = (episodes: readonly AddonVideo[], query: string): AddonVideo[] => {
  const term = query.trim().toLowerCase();
  if (!term) return [...episodes];
  return episodes.filter((video) => {
    if (video.title.toLowerCase().includes(term)) return true;
    if (video.episode === null) return false;
    return String(video.episode) === term || String(video.episode).padStart(2, '0') === term;
  });
};
