import { fetchCapped, makeFetch } from './public-http.ts';

/**
 * Busca de títulos no Cinemeta (addon oficial do Stremio, sem chave): entende prefixo ("the simp" → The Simpsons),
 * o que a busca da TVmaze não faz. Só nome, ano e tipo: serve para sugerir enquanto a pessoa digita.
 */
const http = makeFetch();
/** Só para testes: troca o `fetch` (nunca sai da rede durante `bun test`). */
export const setCinemetaFetchForTests = (next?: Parameters<typeof http.set>[0]): void => http.set(next);

const BASE = 'https://v3-cinemeta.strem.io';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5_000;

export interface CinemetaHit {
  title: string;
  year: string | null;
  mediaType: 'movie' | 'tv';
}

export const parseCinemeta = (body: unknown, mediaType: CinemetaHit['mediaType']): CinemetaHit[] => {
  const metas = body && typeof body === 'object' ? (body as { metas?: unknown }).metas : null;
  if (!Array.isArray(metas)) return [];
  return metas.flatMap((m) => {
    if (!m || typeof m !== 'object') return [];
    const { name, releaseInfo } = m as { name?: unknown; releaseInfo?: unknown };
    if (typeof name !== 'string' || !name.trim()) return [];
    const year = typeof releaseInfo === 'string' ? (/^\d{4}/.exec(releaseInfo)?.[0] ?? null) : null;
    return [{ title: name.trim(), year, mediaType }];
  });
};

const searchType = async (query: string, type: 'movie' | 'series'): Promise<CinemetaHit[]> => {
  const url = `${BASE}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
  const res = await fetchCapped(http.get(), url, { headers: { Accept: 'application/json' } }, TIMEOUT_MS, MAX_BYTES);
  if (res.status < 200 || res.status >= 300 || !res.bytes) throw new Error(`cinemeta respondeu ${res.status}`);
  return parseCinemeta(JSON.parse(new TextDecoder().decode(res.bytes)) as unknown, type === 'movie' ? 'movie' : 'tv');
};

/** Séries e filmes intercalados (o primeiro de cada tipo no topo); um tipo que falha não derruba o outro. Os dois falhando, erro. */
export const cinemetaSearch = async (query: string): Promise<CinemetaHit[]> => {
  const [s, m] = await Promise.allSettled([searchType(query, 'series'), searchType(query, 'movie')]);
  if (s.status === 'rejected' && m.status === 'rejected') throw s.reason;
  const series = s.status === 'fulfilled' ? s.value : [];
  const movies = m.status === 'fulfilled' ? m.value : [];
  const out: CinemetaHit[] = [];
  for (let i = 0; i < Math.max(series.length, movies.length); i++) {
    const s = series[i];
    const m = movies[i];
    if (s) out.push(s);
    if (m) out.push(m);
  }
  return out;
};
