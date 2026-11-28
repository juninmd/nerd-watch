import { withCache } from '../../lib/cache.ts';
import { anilistSearch } from '../anilist.ts';
import { fetchCapped, makeFetch } from '../public-http.ts';
import { parseAniSkip, parseIntroDb, type SkipSegment } from './parse.ts';

const http = makeFetch();
/** Só para testes: troca o `fetch` (nunca sai da rede durante `bun test`). */
export const setSkipTimesFetchForTests = (next?: Parameters<typeof http.set>[0]): void => http.set(next);

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 8_000;
const HOUR = 60 * 60_000;

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetchCapped(http.get(), url, { headers: { Accept: 'application/json' } }, TIMEOUT_MS, MAX_BYTES);
  // 404 = a base não conhece o episódio: não é erro, só não há trechos.
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300 || !res.bytes) throw new Error(`skip-times respondeu ${res.status}`);
  return JSON.parse(new TextDecoder().decode(res.bytes)) as unknown;
};

/** Trechos mudam pouco: cache de 6 h. Falha não entra no cache (a próxima tentativa refaz). */
const introDb = withCache(6 * HOUR, async (imdbId: string, season: number | null, episode: number | null) => {
  const q = new URLSearchParams({ imdb_id: imdbId });
  if (season !== null && episode !== null) {
    q.set('season', String(season));
    q.set('episode', String(episode));
  }
  return parseIntroDb(await getJson(`https://api.introdb.app/segments?${q}`));
});

const aniSkipRaw = withCache(6 * HOUR, async (malId: number, episode: number) => {
  const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].map((t) => `types[]=${t}`).join('&');
  return getJson(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}?${types}&episodeLength=0`);
});

export interface SkipQuery {
  imdbId: string | null;
  season: number | null;
  episode: number | null;
  /** Nome da série: com ele, anime sem trechos no IntroDB tenta a AniSkip (id do MAL pelo AniList). */
  title: string | null;
  duration: number | null;
}

/**
 * IntroDB primeiro; se não trouxer abertura e houver nome, tenta a AniSkip. A AniSkip numera episódios por
 * entrada do MAL (cada temporada é uma), então só a 1ª temporada (ou filme) tem número confiável.
 */
export const skipSegments = async (q: SkipQuery): Promise<SkipSegment[]> => {
  const fromIntro = q.imdbId ? await introDb(q.imdbId, q.season, q.episode).catch(() => []) : [];
  const hasIntro = fromIntro.some((s) => s.kind === 'intro');
  if (hasIntro || !q.title || (q.season !== null && q.season !== 1)) return fromIntro;
  const anime = (await anilistSearch(q.title, 1).catch(() => []))[0];
  if (!anime?.idMal) return fromIntro;
  const raw = await aniSkipRaw(anime.idMal, q.episode ?? 1).catch(() => null);
  const fromAni = parseAniSkip(raw, q.duration);
  // Junta: o que a AniSkip tem e o IntroDB não (por tipo).
  const kinds = new Set(fromIntro.map((s) => s.kind));
  return [...fromIntro, ...fromAni.filter((s) => !kinds.has(s.kind))].sort((a, b) => a.start - b.start);
};
