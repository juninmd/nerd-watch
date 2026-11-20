import { isPlayableVideo } from '../media/playable.ts';

/**
 * Escolha do episódio dentro de um pack de série baixado por torrent.
 *
 * Addons de torrent costumam entregar o pack completo da temporada num infohash só e às vezes **não**
 * mandam `fileIdx` (ou mandam um índice que aponta para vídeo de outro episódio). Sem esta busca, o
 * engine cairia no "primeiro vídeo tocável" e o usuário assistiria o episódio errado.
 *
 * A convenção de nome usada aqui é a que os release groups publicam: `S01E02`, `1x02` e
 * `Season 1 Episode 2`. Tudo é função pura sobre `{name, length}` — não abre torrent.
 */
export interface EpisodeFileLike {
  name: string;
  length: number;
}

export interface EpisodeHint {
  season: number;
  episode: number;
}

const literal = (value: number): string => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `S01E02` / `s1e2` / `S01.E02` / `S01 E02`: o dígito seguinte não pode continuar o número (E21 ≠ E2). */
const seasonEpisode = (hint: EpisodeHint): RegExp =>
  new RegExp(`(?:^|[^a-z0-9])s0*${literal(hint.season)}[\\s._-]*e0*${literal(hint.episode)}(?![0-9])`, 'i');

/** `1x02` / `01x02`, com o mesmo cuidado de fronteira numérica. */
const crossFormat = (hint: EpisodeHint): RegExp => new RegExp(`(?:^|[^0-9])0*${literal(hint.season)}x0*${literal(hint.episode)}(?![0-9])`, 'i');

/** `Season 1 Episode 2` (com ou sem separador). */
const longFormat = (hint: EpisodeHint): RegExp =>
  new RegExp(`season[\\s._-]*0*${literal(hint.season)}[\\s._-]*(?:episode|ep)[\\s._-]*0*${literal(hint.episode)}(?![0-9])`, 'i');

const matches = (name: string, hint: EpisodeHint): boolean => seasonEpisode(hint).test(name) || crossFormat(hint).test(name) || longFormat(hint).test(name);

/**
 * Índice do arquivo do episódio (na ordem original do torrent), ou `null` quando nenhum nome casa.
 * Entre vários candidatos (ex.: duas versões do mesmo episódio), fica o menor vídeo tocável — começa
 * a tocar mais rápido.
 */
export const episodeFileIndex = (files: readonly EpisodeFileLike[], hint: EpisodeHint): number | null => {
  let bestIndex: number | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (let index = 0; index < files.length; index++) {
    const file = files[index] as EpisodeFileLike;
    if (!isPlayableVideo(file.name) || !matches(file.name, hint)) continue;
    if (file.length < bestLength) {
      bestIndex = index;
      bestLength = file.length;
    }
  }
  return bestIndex;
};
