import type { Database } from 'bun:sqlite';
import { httpsUrlOrNull } from '../lib/catalog-text.ts';
import { upsertTitle } from '../repo/titles.ts';
import type { MediaType, TitleRow } from '../types.ts';

/** Título de catálogo enviado pelo cliente (adicionar à biblioteca, "vínculo errado?"). */
export interface CatalogTitleInput {
  source: 'tmdb' | 'archive' | 'tvmaze' | 'anilist';
  sourceId: string;
  mediaType: MediaType;
  title: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
}

export const TITLE_INPUT_ERROR = 'corpo inválido: source, sourceId, mediaType e title são obrigatórios';

const SOURCES = new Set(['tmdb', 'archive', 'tvmaze', 'anilist']);
/** Fontes que guardam a URL completa do pôster; as demais guardam só o caminho da TMDB. */
const ABSOLUTE_POSTER_SOURCES = new Set(['archive', 'tvmaze', 'anilist']);

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Valida o corpo; campos opcionais de tipo errado viram nulo em vez de chegar ao banco. */
export const parseCatalogTitle = (body: Record<string, unknown>): CatalogTitleInput | null => {
  const { source, sourceId, mediaType, title } = body;
  if (!nonEmpty(sourceId) || !nonEmpty(title) || typeof source !== 'string' || !SOURCES.has(source)) return null;
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  return {
    source: source as CatalogTitleInput['source'],
    sourceId,
    mediaType,
    title,
    overview: textOrNull(body.overview),
    posterPath: textOrNull(body.posterPath),
    backdropPath: textOrNull(body.backdropPath),
    releaseDate: textOrNull(body.releaseDate),
    voteAverage: typeof body.voteAverage === 'number' && Number.isFinite(body.voteAverage) ? body.voteAverage : null,
  };
};

export const upsertCatalogTitle = (db: Database, input: CatalogTitleInput): TitleRow =>
  upsertTitle(db, {
    ...input,
    // Pôster de catálogo sem chave (Archive, TVmaze, AniList) é URL completa: só https, para o navegador nunca receber outro esquema.
    posterPath: ABSOLUTE_POSTER_SOURCES.has(input.source) ? httpsUrlOrNull(input.posterPath) : input.posterPath,
  });
