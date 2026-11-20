import { addonContentId } from '../subtitles/stremio-addon.ts';
import { tmdbExternalIds } from '../tmdb.ts';
import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import type { MediaType } from '../../types.ts';
import { AddonError } from './client.ts';
import { type AddonStream, fetchStreams } from './protocol.ts';

/**
 * `index` é a posição que `POST …/streams/:type/:itemId/:index/open` espera (a mesma da lista
 * normalizada). `trackers` fica no servidor: o cliente só manda a posição e o addon é reconsultado.
 */
export interface TitleStream extends Omit<AddonStream, 'trackers'> {
  index: number;
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
  trackerCount: stream.trackerCount,
});

export interface AddonStreamsResult {
  addonId: string;
  name: string;
  host: string;
  /** Tipo e id do protocolo usados na consulta: o cliente precisa deles para abrir o torrent. */
  type: 'movie' | 'series';
  contentId: string;
  streams: TitleStream[];
  /** Mensagem fixa quando o addon falhou; `null` com lista vazia = respondeu "nada para este título". */
  error: string | null;
}

export interface TitleStreams {
  imdbId: string | null;
  addons: AddonStreamsResult[];
}

/** Addon só entra se declara `stream` e o tipo (`movie`/`series`) do título; sem `types` no manifest, tenta mesmo assim. */
export const servesStreams = (addon: InstalledAddon, type: 'movie' | 'series'): boolean =>
  addon.manifest.resources.includes('stream') && (addon.manifest.types.length === 0 || addon.manifest.types.includes(type));

/**
 * Títulos vêm do TMDB e os addons só de streams respondem por id do IMDb: resolvemos `tt…` e
 * perguntamos a cada addon instalado. Falha de um addon não derruba os outros.
 */
export const streamsForTitle = async (
  addons: InstalledAddon[],
  opts: { mediaType: MediaType; tmdbId?: number; imdbId?: string; season: number | null; episode: number | null },
  resolveImdb: (mediaType: MediaType, tmdbId: number) => Promise<string | null> = tmdbExternalIds,
): Promise<TitleStreams> => {
  const type: 'movie' | 'series' = opts.mediaType === 'tv' ? 'series' : 'movie';
  const imdbId = opts.imdbId ?? (opts.tmdbId ? await resolveImdb(opts.mediaType, opts.tmdbId).catch(() => null) : null);
  if (!imdbId) return { imdbId: null, addons: [] };
  // Série sem progresso salvo: o addon exige `tt:T:E`, então caímos no primeiro episódio.
  const contentId = type === 'series' ? addonContentId(imdbId, opts.season ?? 1, opts.episode ?? 1) : imdbId;
  const targets = addons.filter((a) => servesStreams(a, type));
  const addonsOut = await Promise.all(
    targets.map(async (a): Promise<AddonStreamsResult> => {
      const base = { addonId: a.id, name: a.manifest.name, host: new URL(a.baseUrl).host, type, contentId };
      try {
        const streams = (await fetchStreams(a.baseUrl, type, contentId)).map(toClientStream);
        return { ...base, streams, error: null };
      } catch (err) {
        return { ...base, streams: [], error: err instanceof AddonError ? err.message : 'falha inesperada no addon' };
      }
    }),
  );
  return { imdbId, addons: addonsOut };
};
