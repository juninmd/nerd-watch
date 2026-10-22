import { withCache } from '../cache.ts';
import { CatalogRequestError, htmlToText, httpsUrlOrNull } from '../catalog-text.ts';
import { createRateLimiter, RateLimitExceededError } from '../rate-limit.ts';

/**
 * AniList: anime. GraphQL público, sem chave. Limite documentado: 90 req/min, mas o próprio
 * guia avisa que o serviço está em estado degradado com 30 req/min — usamos 30 (o teto mais baixo).
 * Docs: https://docs.anilist.co/ e https://docs.anilist.co/guide/rate-limiting
 */
const MINUTES = 60_000;
const ENDPOINT = 'https://graphql.anilist.co';
const TIMEOUT_MS = 10_000;

const limiter = createRateLimiter('AniList', 30, MINUTES);

/** Só para testes: esvazia a janela do limite de chamadas. */
export const resetAnilistRateLimitForTests = (): void => limiter.reset();

/**
 * As consultas são constantes; o termo do usuário só entra em `variables`. Assim um termo com aspas ou
 * chaves nunca altera a estrutura da consulta (ver tests/anilist-provider.test.ts).
 */
const SEARCH_QUERY = `
query ($search: String!, $perPage: Int!) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, isAdult: false) {
      id
      title { romaji english native }
      format
      status
      startDate { year }
      coverImage { large }
      averageScore
      episodes
      description(asHtml: false)
    }
  }
}`;

const DETAIL_QUERY = `
query ($id: Int!) {
  Media(id: $id, type: ANIME) {
    id
    siteUrl
    title { romaji english native }
    format
    status
    startDate { year }
    coverImage { large }
    averageScore
    episodes
    description(asHtml: false)
    nextAiringEpisode { airingAt episode }
  }
}`;

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null;

const unexpected = (): CatalogRequestError => new CatalogRequestError(502, 'AniList devolveu uma resposta inesperada');

/**
 * A descrição vem em markdown; trechos entre `~!` e `!~` são spoiler marcado pelo próprio AniList.
 * Eles são descartados (não só escondidos): o detalhe mostra a sinopse em texto aberto.
 */
const descriptionText = (raw: unknown): string | null => htmlToText(typeof raw === 'string' ? raw.replace(/~!.*?!~/gs, '') : null);

const pickTitle = (raw: unknown): { title: string; romaji: string | null; english: string | null; native: string | null } => {
  const t = isRecord(raw) ? raw : {};
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const romaji = str(t.romaji);
  const english = str(t.english);
  const native = str(t.native);
  return { title: english ?? romaji ?? native ?? '(sem título)', romaji, english, native };
};

const yearOf = (raw: unknown): string | null => {
  const year = isRecord(raw) ? raw.year : null;
  return typeof year === 'number' && Number.isInteger(year) ? String(year) : null;
};

const coverOf = (raw: unknown): string | null => (isRecord(raw) ? httpsUrlOrNull(raw.large) : null);

/** Uma chamada GraphQL: falhas viram `CatalogRequestError` com mensagem nossa. Devolve `data` já validado como objeto. */
const query = async (gql: string, variables: Record<string, unknown>): Promise<Raw> => {
  try {
    limiter.acquire();
  } catch (err) {
    if (err instanceof RateLimitExceededError) throw new CatalogRequestError(429, err.message);
    throw err;
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: gql, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new CatalogRequestError(502, 'AniList indisponível no momento');
  }
  if (res.status === 429) throw new CatalogRequestError(429, 'AniList: limite de requisições atingido, tente de novo em instantes');
  if (!res.ok) throw new CatalogRequestError(502, `AniList respondeu ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw unexpected();
  }
  if (!isRecord(body)) throw unexpected();
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = isRecord(body.errors[0]) ? body.errors[0] : {};
    if (first.status === 404) throw new CatalogRequestError(404, 'AniList: título não encontrado');
    if (first.status === 429) throw new CatalogRequestError(429, 'AniList: limite de requisições atingido, tente de novo em instantes');
    throw new CatalogRequestError(502, 'AniList recusou a consulta');
  }
  if (!isRecord(body.data)) throw unexpected();
  return body.data;
};

export interface AnilistSearchItem {
  id: number;
  title: string;
  romaji: string | null;
  english: string | null;
  native: string | null;
  format: string | null;
  year: string | null;
  imageUrl: string | null;
  averageScore: number | null;
  episodes: number | null;
  overview: string | null;
}

const toSearchItem = (raw: unknown): AnilistSearchItem | null => {
  if (!isRecord(raw) || typeof raw.id !== 'number') return null;
  const t = pickTitle(raw.title);
  return {
    id: raw.id,
    ...t,
    format: typeof raw.format === 'string' ? raw.format : null,
    year: yearOf(raw.startDate),
    imageUrl: coverOf(raw.coverImage),
    averageScore: typeof raw.averageScore === 'number' ? raw.averageScore : null,
    episodes: typeof raw.episodes === 'number' ? raw.episodes : null,
    overview: descriptionText(raw.description),
  };
};

export const anilistSearch = withCache(15 * MINUTES, async (search: string, perPage = 12): Promise<AnilistSearchItem[]> => {
  const data = await query(SEARCH_QUERY, { search, perPage });
  const page = isRecord(data.Page) ? data.Page : null;
  if (!page || !Array.isArray(page.media)) throw unexpected();
  return page.media.flatMap((m) => {
    const item = toSearchItem(m);
    return item ? [item] : [];
  });
});

export interface AnilistDetails extends AnilistSearchItem {
  status: string | null;
  siteUrl: string | null;
  /** Próximo episódio ainda não exibido; `null` quando o anime terminou ou não há data. */
  nextAiringEpisode: { airingAt: number; episode: number } | null;
}

export const anilistDetails = withCache(60 * MINUTES, async (id: number): Promise<AnilistDetails> => {
  const data = await query(DETAIL_QUERY, { id });
  const media = data.Media;
  if (media === null) throw new CatalogRequestError(404, 'AniList: título não encontrado');
  const item = toSearchItem(media);
  if (!item || !isRecord(media)) throw unexpected();
  const next = isRecord(media.nextAiringEpisode) ? media.nextAiringEpisode : null;
  const airingAt = next && typeof next.airingAt === 'number' ? next.airingAt : null;
  const episode = next && typeof next.episode === 'number' ? next.episode : null;
  return {
    ...item,
    status: typeof media.status === 'string' ? media.status : null,
    siteUrl: httpsUrlOrNull(media.siteUrl),
    nextAiringEpisode: airingAt !== null && episode !== null ? { airingAt, episode } : null,
  };
});
