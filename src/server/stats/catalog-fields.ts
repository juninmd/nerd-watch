/**
 * Gêneros e duração vindos dos catálogos (TMDB, TVmaze, AniList). São dado de catálogo, nunca do usuário:
 * qualquer valor inválido vira `null` ("desconhecido") em vez de derrubar a gravação.
 */

export const GENRES_MAX = 20;
const GENRE_MAX_CHARS = 40;
/** 10 000 min (~7 dias) cobre qualquer filme ou episódio real; acima disso é lixo do provider. */
export const RUNTIME_MAX_MINUTES = 10_000;

/** Lista de gêneros limpa: strings aparadas, sem vazias, sem repetidas, no máximo GENRES_MAX. `null` se não for lista. */
export const normalizeGenres = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.replace(/\s+/g, ' ').trim().slice(0, GENRE_MAX_CHARS);
    if (name && !out.includes(name)) out.push(name);
    if (out.length === GENRES_MAX) break;
  }
  return out;
};

/** Texto gravado em `titles.genres`: JSON de array de strings. `null` fica `null` (nunca buscado). */
export const encodeGenres = (genres: string[] | null): string | null =>
  genres === null ? null : JSON.stringify(genres);

/** Lê `titles.genres`. Texto que não é array JSON de strings vira `null`: o estatística trata como "sem gênero". */
export const decodeGenres = (text: string | null | undefined): string[] | null => {
  if (text === null || text === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return normalizeGenres(parsed);
};

/** Minutos inteiros entre 1 e RUNTIME_MAX_MINUTES; qualquer outra coisa é `null`. */
export const normalizeRuntimeMinutes = (raw: unknown): number | null => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const minutes = Math.round(raw);
  return minutes >= 1 && minutes <= RUNTIME_MAX_MINUTES ? minutes : null;
};
