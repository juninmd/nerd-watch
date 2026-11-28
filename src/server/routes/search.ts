import { Hono } from 'hono';
import { archiveSearchPublicDomain } from '../providers/archive.ts';
import { anilistSearch } from '../providers/anilist.ts';
import { getDb } from '../db/database.ts';
import { hasControlChar } from '../lib/text-guards.ts';
import { searchAddons } from '../providers/stremio/search.ts';
import { listEnabledAddons } from '../repo/stremio-addons.ts';
import { tmdbEnabled, tmdbImageUrl, tmdbSearchMulti } from '../providers/tmdb.ts';
import { tvmazeSearchShows } from '../providers/tvmaze.ts';
import type { SearchResult } from '../types.ts';
import { searchSuggestions } from './search-suggest.ts';

const MAX_QUERY_LEN = 200;

export const searchRoutes = new Hono();

/** Fontes da busca. `?source=` pede uma só: a tela mostra cada uma assim que ela responde (stream-goat). */
export const SEARCH_SOURCES = ['tmdb', 'archive', 'tvmaze', 'anilist', 'addons'] as const;
type SearchSource = (typeof SEARCH_SOURCES)[number];

const tmdbPart = async (query: string): Promise<SearchResult[]> => {
  if (!tmdbEnabled()) return [];
  const rows = await tmdbSearchMulti(query).catch(() => []);
  return rows.map((r) => ({
    source: 'tmdb',
    sourceId: String(r.id),
    mediaType: r.media_type as 'movie' | 'tv',
    title: r.title ?? r.name ?? '(sem título)',
    overview: r.overview,
    posterUrl: tmdbImageUrl(r.poster_path, 'w342'),
    releaseDate: r.release_date ?? r.first_air_date ?? null,
    voteAverage: r.vote_average,
  }));
};

const archivePart = async (query: string): Promise<SearchResult[]> =>
  (await archiveSearchPublicDomain(query, 12).catch(() => [])).map((m) => ({
    source: 'archive',
    sourceId: m.identifier,
    mediaType: 'movie',
    title: m.title,
    overview: m.overview,
    posterUrl: m.thumbnailUrl,
    releaseDate: m.year ? `${m.year}-01-01` : null,
    voteAverage: null,
  }));

const tvmazePart = async (query: string): Promise<SearchResult[]> =>
  (await tvmazeSearchShows(query).catch(() => [])).map((s) => ({
    source: 'tvmaze',
    sourceId: String(s.id),
    mediaType: 'tv',
    title: s.name,
    overview: s.overview ?? '',
    posterUrl: s.imageUrl,
    releaseDate: s.year ? `${s.year}-01-01` : null,
    voteAverage: s.rating,
  }));

const anilistPart = async (query: string): Promise<SearchResult[]> =>
  (await anilistSearch(query, 12).catch(() => [])).map((m) => ({
    source: 'anilist',
    sourceId: String(m.id),
    mediaType: m.format === 'MOVIE' ? 'movie' : 'tv',
    title: m.title,
    overview: m.overview ?? '',
    posterUrl: m.imageUrl,
    releaseDate: m.year ? `${m.year}-01-01` : null,
    voteAverage: m.averageScore === null ? null : m.averageScore / 10,
  }));

const addonsPart = (query: string) =>
  getDb()
    .then((db) => searchAddons(listEnabledAddons(db), query))
    .catch(() => [] as Awaited<ReturnType<typeof searchAddons>>);

const TITLE_PARTS: Record<Exclude<SearchSource, 'addons'>, (q: string) => Promise<SearchResult[]>> = {
  tmdb: tmdbPart,
  archive: archivePart,
  tvmaze: tvmazePart,
  anilist: anilistPart,
};

const readQuery = (raw: string | undefined): string | { error: string } => {
  const query = raw?.trim() ?? '';
  if (!query) return { error: 'parâmetro "q" é obrigatório' };
  if (query.length > MAX_QUERY_LEN || hasControlChar(query)) return { error: 'consulta inválida' };
  return query;
};

/** Até 8 nomes para o campo de busca enquanto se digita (TMDB com chave; sem ela, TVmaze). */
searchRoutes.get('/suggest', async (c) => {
  const query = readQuery(c.req.query('q'));
  if (typeof query !== 'string') return c.json(query, 400);
  return c.json({ suggestions: await searchSuggestions(query) });
});

searchRoutes.get('/', async (c) => {
  const query = readQuery(c.req.query('q'));
  if (typeof query !== 'string') return c.json(query, 400);
  const source = c.req.query('source');
  if (source !== undefined && !(SEARCH_SOURCES as readonly string[]).includes(source))
    return c.json({ error: `source deve ser um de: ${SEARCH_SOURCES.join(', ')}` }, 400);
  const wants = (s: SearchSource) => source === undefined || source === s;

  // Cada fonte falha sozinha: a queda de uma API não esvazia a busca inteira.
  const [titleParts, addonResults] = await Promise.all([
    Promise.all((Object.keys(TITLE_PARTS) as Array<keyof typeof TITLE_PARTS>).map((s) => (wants(s) ? TITLE_PARTS[s](query) : []))),
    wants('addons') ? addonsPart(query) : [],
  ]);
  return c.json({ results: titleParts.flat(), addonResults, tmdbEnabled: tmdbEnabled() });
});
