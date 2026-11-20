import { addonContentId } from '../subtitles/stremio-addon.ts';
import { tmdbExternalIds } from '../tmdb.ts';
import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import type { MediaType } from '../../types.ts';
import { AddonError } from './client.ts';
import { type AddonStream, fetchStreams } from './protocol.ts';

export interface AddonStreamsResult {
  addonId: string;
  name: string;
  host: string;
  streams: AddonStream[];
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
  const type = opts.mediaType === 'tv' ? 'series' : 'movie';
  const imdbId = opts.imdbId ?? (opts.tmdbId ? await resolveImdb(opts.mediaType, opts.tmdbId).catch(() => null) : null);
  if (!imdbId) return { imdbId: null, addons: [] };
  // Série sem progresso salvo: o addon exige `tt:T:E`, então caímos no primeiro episódio.
  const contentId = type === 'series' ? addonContentId(imdbId, opts.season ?? 1, opts.episode ?? 1) : imdbId;
  const targets = addons.filter((a) => servesStreams(a, type));
  const addonsOut = await Promise.all(
    targets.map(async (a): Promise<AddonStreamsResult> => {
      const base = { addonId: a.id, name: a.manifest.name, host: new URL(a.baseUrl).host };
      try {
        return { ...base, streams: await fetchStreams(a.baseUrl, type, contentId), error: null };
      } catch (err) {
        return { ...base, streams: [], error: err instanceof AddonError ? err.message : 'falha inesperada no addon' };
      }
    }),
  );
  return { imdbId, addons: addonsOut };
};
