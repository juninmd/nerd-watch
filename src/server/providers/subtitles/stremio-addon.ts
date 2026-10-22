import { withCache } from '../../cache.ts';

/**
 * Cliente do protocolo de addons do Stremio — a parte reaproveitável daquele ecossistema.
 *
 * Vale a pena porque o contrato é minúsculo e padronizado: o addon publica um `/manifest.json` e
 * responde `GET {base}/subtitles/{movie|series}/{id}.json` devolvendo `{ subtitles: [...] }`. Um
 * único adaptador deste tipo dá acesso a várias fontes sem reimplementar scraper de cada site.
 *
 * Limitação estrutural: o id é sempre do **IMDb** (`idPrefixes: ["tt"]`), então tudo depende de
 * `tmdbExternalIds`. Para série, o id tem a forma `tt1234567:temporada:episódio`.
 *
 * Escopo: aqui não existe `stream`/`catalog` — só `subtitles`. Puxar addon de stream traria os
 * indexadores de catálogo comercial, que é justamente o que o app não faz.
 */

const MINUTES = 60_000;

export interface StremioManifest {
  id: string;
  name: string;
  version?: string;
  resources?: unknown[];
  types?: string[];
  idPrefixes?: string[];
}

/** Formato cru devolvido pelo addon; só os campos que usamos. */
interface RawAddonSubtitle {
  id: string;
  url: string;
  lang?: string;
  SubEncoding?: string;
  subtitleFileName?: string;
  movieReleaseName?: string;
  releaseGroup?: string;
}

export interface AddonSubtitle {
  id: string;
  url: string;
  /** Código ISO 639-2 do addon (ex.: `pob`, `eng`). */
  rawLang: string;
  fileName: string;
  release: string;
}

export class AddonUnavailableError extends Error {
  constructor(
    public baseUrl: string,
    message: string,
  ) {
    super(message);
    this.name = 'AddonUnavailableError';
  }
}

const normalizeBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export const fetchManifest = withCache(24 * 60 * MINUTES, async (baseUrl: string): Promise<StremioManifest> => {
  const base = normalizeBase(baseUrl);
  const res = await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AddonUnavailableError(base, `manifest respondeu ${res.status}`);
  return (await res.json()) as StremioManifest;
});

/**
 * Um addon só serve se declarar o recurso `subtitles` e aceitar id do IMDb. Serve para descartar
 * cedo um addon configurado errado, em vez de gastar requisição por título.
 */
export const supportsSubtitles = (manifest: StremioManifest): boolean => {
  const hasResource =
    Array.isArray(manifest.resources) &&
    manifest.resources.some((r) => (typeof r === 'string' ? r === 'subtitles' : (r as { name?: string }).name === 'subtitles'));
  const hasImdbPrefix = !manifest.idPrefixes || manifest.idPrefixes.includes('tt');
  return hasResource && hasImdbPrefix;
};

/** Monta o id no formato do protocolo: `tt1234567` (filme) ou `tt1234567:1:2` (série). */
export const addonContentId = (imdbId: string, season?: number | null, episode?: number | null): string =>
  season && episode ? `${imdbId}:${season}:${episode}` : imdbId;

export const fetchAddonSubtitles = withCache(
  30 * MINUTES,
  async (baseUrl: string, type: 'movie' | 'series', contentId: string): Promise<AddonSubtitle[]> => {
    const base = normalizeBase(baseUrl);
    const res = await fetch(`${base}/subtitles/${type}/${encodeURIComponent(contentId)}.json`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new AddonUnavailableError(base, `respondeu ${res.status}`);
    const data = (await res.json()) as { subtitles?: RawAddonSubtitle[] };

    return (data.subtitles ?? [])
      .filter((s) => Boolean(s.url))
      .map((s) => ({
        id: String(s.id ?? s.url),
        url: s.url,
        rawLang: (s.lang ?? '').toLowerCase(),
        fileName: s.subtitleFileName ?? '',
        release: s.movieReleaseName ?? s.releaseGroup ?? '',
      }));
  },
);

export { normalizeBase };
