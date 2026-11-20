import type { AddonMetaDto } from '../api/stremio.ts';

/** Id de episódio no protocolo (`tt12345` ou `tt12345:1:2`). */
const IMDB_EP_RE = /^(tt\d{5,10})(?::(\d{1,4}):(\d{1,4}))?$/;

export interface ParsedImdbEpisode {
  imdbId: string;
  season: number | null;
  episode: number | null;
}

export const parseImdbEpisodeId = (id: string): ParsedImdbEpisode | null => {
  const m = IMDB_EP_RE.exec(id.trim());
  if (!m) return null;
  return {
    imdbId: m[1] as string,
    season: m[2] !== undefined ? Number(m[2]) : null,
    episode: m[3] !== undefined ? Number(m[3]) : null,
  };
};

export const episodeLabel = (v: AddonMetaDto['videos'][number]): string => {
  const prefix = [v.season !== null ? `T${v.season}` : null, v.episode !== null ? `E${v.episode}` : null]
    .filter(Boolean)
    .join(' ');
  return prefix ? `${prefix} · ${v.title}` : v.title;
};

/**
 * Em séries, o item raiz (`tt12345`) raramente tem stream direto; quando o addon lista episódios,
 * devolver todos os vídeos listados (mesmo sem `season`/`episode` numéricos) evita esconder episódios.
 */
export const listEpisodes = (meta: AddonMetaDto): AddonMetaDto['videos'] => {
  const numbered = meta.videos.filter((v) => v.season !== null || v.episode !== null);
  if (numbered.length > 0) return numbered;
  return meta.type === 'series' ? meta.videos : [];
};
