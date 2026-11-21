import { mapLimit } from '../../lib/map-limit.ts';
import { addonContentId } from '../subtitles/stremio-addon.ts';
import { tmdbExternalIds } from '../tmdb.ts';
import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import type { MediaType } from '../../types.ts';
import { AddonError } from './client.ts';
import { bestCatalogMatch } from './match.ts';
import { type AddonStream, fetchCatalog, fetchMeta, fetchStreams } from './protocol.ts';

/**
 * Quantos addons são consultados ao mesmo tempo. Um por vez somaria a latência de todos; todos de uma
 * vez vira rajada (addon grande responde 429 e o app local segura sockets à toa).
 */
export const ADDON_CONCURRENCY = 4;

/**
 * `index` é a posição que `POST …/streams/:type/:itemId/:index/open` espera (a mesma da lista
 * normalizada). `trackers` fica no servidor: o cliente só manda a posição e o addon é reconsultado.
 */
export interface TitleStream extends Omit<AddonStream, 'trackers' | 'subtitles'> {
  index: number;
  /** Faixas de legenda do addon para este stream: só id/idioma, a URL fica no servidor. */
  subtitles: Array<{ id: string | null; lang: string }>;
}

const toClientStream = (stream: AddonStream, index: number): TitleStream => ({
  index,
  kind: stream.kind,
  title: stream.title,
  name: stream.name,
  description: stream.description,
  url: stream.url,
  infoHash: stream.infoHash,
  fileIdx: stream.fileIdx,
  filename: stream.filename,
  videoSize: stream.videoSize,
  notWebReady: stream.notWebReady,
  bingeGroup: stream.bingeGroup,
  countryWhitelist: stream.countryWhitelist,
  subtitleLangs: stream.subtitleLangs,
  subtitles: stream.subtitles.map(({ id, lang }) => ({ id, lang })),
  trackerCount: stream.trackerCount,
});

export interface AddonStreamsResult {
  addonId: string;
  name: string;
  host: string;
  /** Tipo e id do protocolo usados na consulta: o cliente precisa deles para abrir o torrent. */
  type: string;
  contentId: string;
  streams: TitleStream[];
  /** Mensagem fixa quando o addon falhou; `null` com lista vazia = respondeu "nada para este título". */
  error: string | null;
  /**
   * Preenchido quando o id foi descoberto pelo catálogo do addon (ele não aceita o id do app): é o
   * nome que o addon deu ao item, para a tela poder dizer de onde vieram os streams.
   */
  matchedTitle?: string;
}

export interface TitleStreams {
  imdbId: string | null;
  addons: AddonStreamsResult[];
}

export interface TitleStreamsOpts {
  mediaType: MediaType;
  tmdbId?: number;
  imdbId?: string;
  /** Nome do título no app: só é usado para achar o item no catálogo de addon com id próprio. */
  title?: string;
  /** Ano do título no app (`2004`), para desempatar nomes iguais. */
  year?: string | null;
  season: number | null;
  episode: number | null;
  /**
   * Addon e item abertos na tela (catálogo/meta do addon): os streams dele são consultados pelo id
   * original, o que também funciona para itens sem IMDb (ex.: `afhd:…`).
   */
  own?: { addonId: string; type: string; itemId: string };
}

/**
 * Addon só entra se declara `stream` e o tipo (`movie`/`series`) do título; sem `types` no manifest,
 * tenta mesmo assim. `idPrefixes`, quando declarado, filtra pelo esquema do id: um addon só de
 * `kitsu:` não deve ser chamado com `tt…` (é uma requisição garantidamente vazia).
 */
export const servesStreams = (addon: InstalledAddon, type: 'movie' | 'series', contentId?: string): boolean => {
  if (!addon.manifest.resources.includes('stream')) return false;
  if (addon.manifest.types.length > 0 && !addon.manifest.types.includes(type)) return false;
  const prefixes = addon.manifest.idPrefixes ?? [];
  if (contentId && prefixes.length > 0 && !prefixes.some((prefix) => contentId.startsWith(prefix))) return false;
  return true;
};

/** O item pode vir com o tipo do catálogo (`series`, `anime`, `other`); só vale se o manifest declarar. */
const declaresType = (addon: InstalledAddon, type: string): boolean => addon.manifest.types.length === 0 || addon.manifest.types.includes(type);

/** Catálogo pesquisável do addon para o tipo do título: é o que permite achar o id próprio pelo nome. */
export const searchableCatalogOf = (addon: InstalledAddon, type: string) => addon.manifest.catalogs.find((catalog) => catalog.type === type && catalog.searchable) ?? null;

/** Addon que não aceita o id do app mas pode ser resolvido pelo próprio catálogo. */
export const servesStreamsBySearch = (addon: InstalledAddon, type: string): boolean =>
  addon.manifest.resources.includes('stream') && declaresType(addon, type) && searchableCatalogOf(addon, type) !== null;

export interface ResolveDeps {
  catalog?: typeof fetchCatalog;
  meta?: typeof fetchMeta;
}

/**
 * Addons que usam id próprio (`afhd:…`, `kitsu:…`) não respondem ao `tt…` do app: perguntamos pelo
 * **nome** no catálogo pesquisável deles e usamos o id que devolverem. Em série, o id de episódio
 * desses addons não segue `S:E`, então o episódio sai do `videos` do meta.
 */
export const resolveAddonItem = async (
  addon: InstalledAddon,
  type: 'movie' | 'series',
  opts: { title: string; year?: string | null; season: number | null; episode: number | null },
  deps: ResolveDeps = {},
): Promise<{ contentId: string; matchedTitle: string } | null> => {
  const catalog = searchableCatalogOf(addon, type);
  if (!catalog) return null;
  const fetchCatalogFn = deps.catalog ?? fetchCatalog;
  const fetchMetaFn = deps.meta ?? fetchMeta;

  const items = await fetchCatalogFn(addon.baseUrl, type, catalog.id, { search: opts.title.slice(0, 100) });
  const best = bestCatalogMatch(items, { title: opts.title, year: opts.year });
  if (!best) return null;

  if (type === 'series') {
    const season = opts.season ?? 1;
    const episode = opts.episode ?? 1;
    const meta = await fetchMetaFn(addon.baseUrl, type, best.id).catch(() => null);
    const hit = meta?.videos.find((video) => video.season === season && video.episode === episode);
    if (hit) return { contentId: hit.id, matchedTitle: best.name };
  }
  return { contentId: best.id, matchedTitle: best.name };
};

/** Consulta um addon e devolve o grupo já normalizado; falha vira `error` e não derruba os outros. */
const streamsOfAddon = async (
  addon: InstalledAddon,
  type: string,
  contentId: string,
  fetchFn: typeof fetchStreams,
): Promise<AddonStreamsResult> => {
  const base = { addonId: addon.id, name: addon.manifest.name, host: new URL(addon.baseUrl).host, type, contentId };
  try {
    const streams = (await fetchFn(addon.baseUrl, type, contentId)).map(toClientStream);
    return { ...base, streams, error: null };
  } catch (err) {
    return { ...base, streams: [], error: err instanceof AddonError ? err.message : 'falha inesperada no addon' };
  }
};

/**
 * Títulos vêm do TMDB e os addons só de streams respondem por id do IMDb: resolvemos `tt…` e
 * perguntamos a cada addon instalado. Falha de um addon não derruba os outros.
 *
 * Quando a tela é a de um item do próprio addon (`own`), esse addon é consultado pelo id original
 * (que pode não ter IMDb) e os outros addons de stream entram pelo IMDb, formando uma lista só.
 */
export const streamsForTitle = async (
  addons: InstalledAddon[],
  opts: TitleStreamsOpts,
  resolveImdb: (mediaType: MediaType, tmdbId: number) => Promise<string | null> = tmdbExternalIds,
  fetchFn: typeof fetchStreams = fetchStreams,
  resolveDeps: ResolveDeps = {},
): Promise<TitleStreams> => {
  const type: 'movie' | 'series' = opts.mediaType === 'tv' ? 'series' : 'movie';
  const imdbId = opts.imdbId ?? (opts.tmdbId ? await resolveImdb(opts.mediaType, opts.tmdbId).catch(() => null) : null);

  const own = opts.own;
  const ownAddon = own ? addons.find((a) => a.id === own.addonId) : undefined;
  const ownServes = Boolean(own && ownAddon?.manifest.resources.includes('stream') && declaresType(ownAddon, own.type));
  // Série sem progresso salvo: o addon exige `tt:T:E`, então caímos no primeiro episódio.
  const contentId = imdbId ? (type === 'series' ? addonContentId(imdbId, opts.season ?? 1, opts.episode ?? 1) : imdbId) : null;

  // Próprio addon e os demais em paralelo: um addon lento não soma o seu tempo ao dos outros.
  // Só exclui o addon do fan-out quando ele já foi consultado pelo id original.
  const skipId = ownServes ? ownAddon?.id : undefined;
  const byIdAddons = contentId ? addons.filter((a) => servesStreams(a, type, contentId) && a.id !== skipId) : [];
  const searchTitle = opts.title?.trim() || undefined;
  const bySearchAddons = searchTitle
    ? addons.filter((a) => a.id !== skipId && !byIdAddons.some((b) => b.id === a.id) && servesStreamsBySearch(a, type)).slice(0, 3)
    : [];

  const [ownResult, others, resolved] = await Promise.all([
    own && ownAddon && ownServes ? streamsOfAddon(ownAddon, own.type, own.itemId, fetchFn) : Promise.resolve(null),
    mapLimit(byIdAddons, ADDON_CONCURRENCY, (a) => streamsOfAddon(a, type, contentId as string, fetchFn)),
    mapLimit(bySearchAddons, 2, async (a): Promise<AddonStreamsResult | null> => {
      const hit = await resolveAddonItem(a, type, { title: searchTitle as string, year: opts.year ?? null, season: opts.season, episode: opts.episode }, resolveDeps).catch(() => null);
      if (!hit) return null;
      const group = await streamsOfAddon(a, type, hit.contentId, fetchFn);
      // Addon que respondeu "nada" para o item casado não vira card vazio; erro continua visível.
      if (group.error === null && group.streams.length === 0) return null;
      return { ...group, matchedTitle: hit.matchedTitle };
    }).then((list) => list.filter((group): group is AddonStreamsResult => group !== null)),
  ]);

  const groups: AddonStreamsResult[] = ownResult ? [ownResult, ...others, ...resolved] : [...others, ...resolved];

  // O item raiz de uma série costuma não ter stream no próprio addon; se outro addon respondeu,
  // esconder esse "nada encontrado" evita um card vazio ao lado dos torrents. Erro continua visível.
  if (groups.length > 1 && ownResult && ownResult.error === null && ownResult.streams.length === 0) groups.shift();

  return { imdbId, addons: groups };
};
