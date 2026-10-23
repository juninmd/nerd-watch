import { withCache } from '../cache.ts';
import { CatalogRequestError, htmlToText, httpsUrlOrNull } from '../catalog-text.ts';
import { normalizeGenres, normalizeRuntimeMinutes } from '../stats/catalog-fields.ts';
import { createRateLimiter, RateLimitExceededError } from '../rate-limit.ts';

/**
 * TVmaze: séries e datas de exibição de episódios. Sem chave. Dados sob CC BY-SA: a atribuição
 * aparece no detalhe (ver `TVMAZE_ATTRIBUTION`).
 * Docs: https://www.tvmaze.com/api — limite documentado: 20 chamadas a cada 10 s por IP.
 */
const MINUTES = 60_000;
const BASE = 'https://api.tvmaze.com';
const TIMEOUT_MS = 10_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TVMAZE_ATTRIBUTION = { name: 'TVmaze', url: 'https://www.tvmaze.com/', license: 'CC BY-SA' } as const;

const limiter = createRateLimiter('TVmaze', 20, 10_000);

/** Só para testes: esvazia a janela do limite de chamadas. */
export const resetTvmazeRateLimitForTests = (): void => limiter.reset();

const get = async (path: string, params: Record<string, string> = {}): Promise<unknown> => {
  try {
    limiter.acquire();
  } catch (err) {
    if (err instanceof RateLimitExceededError) throw new CatalogRequestError(429, err.message);
    throw err;
  }
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new CatalogRequestError(502, 'TVmaze indisponível no momento');
  }
  if (res.status === 404) throw new CatalogRequestError(404, 'TVmaze: título não encontrado');
  if (res.status === 429) throw new CatalogRequestError(429, 'TVmaze: limite de requisições atingido, tente de novo em instantes');
  if (!res.ok) throw new CatalogRequestError(502, `TVmaze respondeu ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new CatalogRequestError(502, 'TVmaze devolveu uma resposta inesperada');
  }
};

const unexpected = (): CatalogRequestError => new CatalogRequestError(502, 'TVmaze devolveu uma resposta inesperada');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const imageOf = (raw: unknown): string | null => {
  if (!isRecord(raw)) return null;
  return httpsUrlOrNull(raw.medium) ?? httpsUrlOrNull(raw.original);
};

const yearOf = (date: string | null): string | null => (date ? date.slice(0, 4) : null);

export interface TvmazeShowSummary {
  id: number;
  name: string;
  year: string | null;
  status: string | null;
  overview: string | null;
  imageUrl: string | null;
  rating: number | null;
}

const toSummary = (show: Record<string, unknown>): TvmazeShowSummary => {
  if (typeof show.id !== 'number' || typeof show.name !== 'string') throw unexpected();
  const rating = isRecord(show.rating) && typeof show.rating.average === 'number' ? show.rating.average : null;
  return {
    id: show.id,
    name: show.name,
    year: yearOf(typeof show.premiered === 'string' ? show.premiered : null),
    status: typeof show.status === 'string' ? show.status : null,
    overview: htmlToText(typeof show.summary === 'string' ? show.summary : null),
    imageUrl: imageOf(show.image),
    rating,
  };
};

/** `/search/shows?q=` devolve `[{ score, show }]`. */
export const tvmazeSearchShows = withCache(15 * MINUTES, async (query: string): Promise<TvmazeShowSummary[]> => {
  const data = await get('/search/shows', { q: query });
  if (!Array.isArray(data)) throw unexpected();
  return data.flatMap((hit) => (isRecord(hit) && isRecord(hit.show) ? [toSummary(hit.show)] : []));
});

export interface TvmazeEpisode {
  season: number;
  /** `null` em especiais sem número: o chamador decide se ignora. */
  number: number | null;
  name: string;
  airdate: string | null;
  runtime: number | null;
  overview: string | null;
  imageUrl: string | null;
}

export interface TvmazeShowDetails extends TvmazeShowSummary {
  officialUrl: string | null;
  pageUrl: string | null;
  premiered: string | null;
  ended: string | null;
  episodes: TvmazeEpisode[];
  /** Gêneros do show (`[]` se o campo faltar; a TVmaze sempre o envia). */
  genres: string[];
  /** Duração típica do episódio (`averageRuntime`, ou `runtime` quando não há média). */
  runtimeMinutes: number | null;
}

const toEpisode = (raw: unknown): TvmazeEpisode | null => {
  if (!isRecord(raw) || typeof raw.season !== 'number' || !Number.isInteger(raw.season)) return null;
  const airdate = typeof raw.airdate === 'string' && DATE_RE.test(raw.airdate) ? raw.airdate : null;
  return {
    season: raw.season,
    number: typeof raw.number === 'number' && Number.isInteger(raw.number) ? raw.number : null,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Sem título',
    airdate,
    runtime: typeof raw.runtime === 'number' ? raw.runtime : null,
    overview: htmlToText(typeof raw.summary === 'string' ? raw.summary : null),
    imageUrl: imageOf(raw.image),
  };
};

/** `/shows/:id?embed=episodes`: a documentação usa `embed=episodes` (sem colchetes). */
export const tvmazeShowDetails = withCache(60 * MINUTES, async (id: number): Promise<TvmazeShowDetails> => {
  const raw = await get(`/shows/${id}`, { embed: 'episodes' });
  if (!isRecord(raw)) throw unexpected();
  const summary = toSummary(raw);
  const embedded = isRecord(raw._embedded) && Array.isArray(raw._embedded.episodes) ? raw._embedded.episodes : [];
  const episodes = embedded.flatMap((ep) => {
    const parsed = toEpisode(ep);
    return parsed ? [parsed] : [];
  });
  return {
    ...summary,
    officialUrl: httpsUrlOrNull(raw.officialSite),
    pageUrl: httpsUrlOrNull(raw.url),
    premiered: typeof raw.premiered === 'string' && DATE_RE.test(raw.premiered) ? raw.premiered : null,
    ended: typeof raw.ended === 'string' && DATE_RE.test(raw.ended) ? raw.ended : null,
    episodes,
    genres: normalizeGenres(raw.genres) ?? [],
    runtimeMinutes: normalizeRuntimeMinutes(raw.averageRuntime ?? raw.runtime),
  };
});
