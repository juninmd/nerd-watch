import { mapLimit } from '../../lib/map-limit.ts';
import { addonContentId } from '../subtitles/stremio-addon.ts';
import { tmdbExternalIds } from '../tmdb.ts';
import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import type { MediaType } from '../../types.ts';
import { AddonError } from './client.ts';
import { type AddonStream, fetchStreams } from './protocol.ts';

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
}

export interface TitleStreams {
  imdbId: string | null;
  addons: AddonStreamsResult[];
}

export interface TitleStreamsOpts {
  mediaType: MediaType;
  tmdbId?: number;
  imdbId?: string;
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
  const [ownResult, others] = await Promise.all([
    own && ownAddon && ownServes ? streamsOfAddon(ownAddon, own.type, own.itemId, fetchFn) : Promise.resolve(null),
    contentId
      ? mapLimit(
          addons.filter((a) => servesStreams(a, type, contentId) && a.id !== skipId),
          ADDON_CONCURRENCY,
          (a) => streamsOfAddon(a, type, contentId, fetchFn),
        )
      : Promise.resolve([] as AddonStreamsResult[]),
  ]);
  const groups: AddonStreamsResult[] = ownResult ? [ownResult, ...others] : others;

  // O item raiz de uma série costuma não ter stream no próprio addon; se outro addon respondeu,
  // esconder esse "nada encontrado" evita um card vazio ao lado dos torrents. Erro continua visível.
  if (groups.length > 1 && ownResult && ownResult.error === null && ownResult.streams.length === 0) groups.shift();

  return { imdbId, addons: groups };
};
