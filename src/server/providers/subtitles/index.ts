import { config } from '../../config.ts';
import { tmdbExternalIds } from '../tmdb.ts';
import { searchSubtitles as searchOpenSubtitlesRest, requestSubtitleDownload, openSubtitlesEnabled } from '../opensubtitles.ts';
import { normalizeLanguage, languageAccepted } from './languages.ts';
import { addonContentId, fetchAddonSubtitles, fetchManifest, supportsSubtitles } from './stremio-addon.ts';
import type { MediaType } from '../../types.ts';

/**
 * Agrega fontes de legenda atrás de um formato único.
 *
 * Duas famílias, com naturezas diferentes e por isso campos diferentes:
 *
 * - **Addons (sem chave).** É o caminho do Stremio: o addon devolve a URL direta do arquivo. Não
 *   há cota nem cadastro — é o que faz a busca de legenda funcionar sem `OPENSUBTITLES_API_KEY`.
 * - **OpenSubtitles.com REST (com chave).** Devolve um `fileId` e o link só sai depois de um POST,
 *   que tem limite diário. Continua valendo como segunda fonte quando a chave existe.
 *
 * `Promise.allSettled`: uma fonte fora do ar não pode derrubar a busca inteira.
 */

/** Quantos resultados por fonte, antes de misturar. */
const PER_SOURCE_LIMIT = 25;

export interface SubtitleResult {
  /** Nome legível da fonte (vai para a interface). */
  source: string;
  /** Identificador da legenda dentro da fonte. */
  id: string;
  languageCode: string;
  language: string;
  release: string;
  /** `null` quando a fonte não informa (os addons do Stremio não informam). */
  downloads: number | null;
  /** Addons: URL direta do arquivo. */
  directUrl?: string;
  /** OpenSubtitles REST: precisa de POST para virar link. */
  fileId?: number;
}

export interface SubtitleSearchOptions {
  /** Query livre — usada só pela fonte que aceita busca textual. */
  query?: string;
  tmdbId?: number;
  mediaType?: MediaType;
  imdbId?: string;
  season?: number | null;
  episode?: number | null;
}

export interface SubtitleSearchOutcome {
  results: SubtitleResult[];
  /** Fontes que responderam (mesmo que sem resultado). */
  sources: string[];
  /** Fontes que falharam ou não estão configuradas. */
  unavailable: string[];
  /** `false` quando nenhuma fonte está utilizável. */
  enabled: boolean;
}

const acceptedLanguages = (): string[] =>
  config.subtitles.languages
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Resolve o id do IMDb — sem ele nenhum addon responde. */
const resolveImdbId = async (opts: SubtitleSearchOptions): Promise<string | null> => {
  if (opts.imdbId) return opts.imdbId;
  if (!opts.tmdbId || !opts.mediaType) return null;
  try {
    return await tmdbExternalIds(opts.mediaType, opts.tmdbId);
  } catch {
    // TMDB sem chave ou fora do ar: sem imdbId a busca por addon simplesmente não acontece.
    return null;
  }
};

const searchAddons = async (
  imdbId: string,
  type: 'movie' | 'series',
  season?: number | null,
  episode?: number | null,
): Promise<{ results: SubtitleResult[]; unavailable: string[] }> => {
  const contentId = addonContentId(imdbId, season, episode);
  const accepted = acceptedLanguages();

  const settled = await Promise.allSettled(
    config.subtitles.addons.map(async (baseUrl) => {
      const manifest = await fetchManifest(baseUrl);
      if (!supportsSubtitles(manifest)) throw new Error(`${manifest.name || baseUrl} não serve legendas`);
      const addonSubtitles = await fetchAddonSubtitles(baseUrl, type, contentId);

      return addonSubtitles
        .map((s): SubtitleResult => {
          const lang = normalizeLanguage(s.rawLang);
          return {
            source: manifest.name || baseUrl,
            id: s.id,
            languageCode: lang.code,
            language: lang.label,
            release: s.release,
            downloads: null,
            directUrl: s.url,
          };
        })
        .filter((r) => languageAccepted(r.languageCode, accepted))
        .slice(0, PER_SOURCE_LIMIT);
    }),
  );

  const results: SubtitleResult[] = [];
  const unavailable: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') results.push(...outcome.value);
    else unavailable.push(`${config.subtitles.addons[index] ?? 'addon'}: ${outcome.reason?.message ?? outcome.reason}`);
  });
  return { results, unavailable };
};

const searchOpenSubtitles = async (opts: SubtitleSearchOptions): Promise<SubtitleResult[]> => {
  const found = await searchOpenSubtitlesRest({ query: opts.query, tmdbId: opts.tmdbId });
  return found.slice(0, PER_SOURCE_LIMIT).map((r): SubtitleResult => {
    const lang = normalizeLanguage(r.language);
    return {
      source: 'OpenSubtitles.com',
      id: r.subtitleId,
      languageCode: lang.code,
      language: lang.label,
      release: r.release,
      downloads: r.downloadCount,
      fileId: r.fileId,
    };
  });
};

/** Ordena por idioma preferido (na ordem configurada) e, dentro dele, por popularidade. */
const sortByPreference = (results: SubtitleResult[]): SubtitleResult[] => {
  const order = acceptedLanguages();
  const rank = (code: string): number => {
    const index = order.findIndex((wanted) => languageAccepted(code, [wanted]));
    return index === -1 ? order.length : index;
  };
  return [...results].sort(
    (a, b) => rank(a.languageCode) - rank(b.languageCode) || (b.downloads ?? 0) - (a.downloads ?? 0),
  );
};

export const searchAllSubtitles = async (opts: SubtitleSearchOptions): Promise<SubtitleSearchOutcome> => {
  const configuredAddons = config.subtitles.addons;
  const restEnabled = openSubtitlesEnabled();
  const unavailable: string[] = [];
  const allResults: SubtitleResult[] = [];

  const imdbId = await resolveImdbId(opts);
  const type = opts.mediaType === 'tv' ? 'series' : 'movie';

  if (configuredAddons.length === 0 && !restEnabled) {
    return { results: [], sources: [], unavailable: [], enabled: false };
  }
  if (!imdbId && !restEnabled) {
    // Sem imdbId nenhum addon responde, e sem chave a REST também não: não há busca possível.
    return { results: [], sources: [], unavailable: [...configuredAddons], enabled: false };
  }

  const jobs: Array<Promise<void>> = [];
  if (imdbId) {
    jobs.push(
      searchAddons(imdbId, type, opts.season, opts.episode).then((outcome) => {
        allResults.push(...outcome.results);
        unavailable.push(...outcome.unavailable);
      }),
    );
  }
  if (restEnabled && (opts.tmdbId || opts.query)) {
    jobs.push(
      searchOpenSubtitles(opts).then((found) => {
        allResults.push(...found);
      }),
    );
  }

  const settled = await Promise.allSettled(jobs);
  for (const outcome of settled) {
    if (outcome.status === 'rejected') unavailable.push(String(outcome.reason?.message ?? outcome.reason));
  }

  const sources = [...new Set(allResults.map((r) => r.source))];
  return { results: sortByPreference(allResults), sources, unavailable, enabled: true };
};

export interface SubtitleDownloadPayload {
  /** Nome da fonte, como veio no resultado. */
  source?: string;
  id?: string;
  imdbId?: string;
  mediaType?: MediaType;
  season?: number | null;
  episode?: number | null;
  /** Caminho da OpenSubtitles REST. */
  fileId?: number;
}

export type SubtitleDownloadResolution =
  | { kind: 'link'; url: string; remaining?: number }
  | { kind: 'proxy'; url: string }
  | { kind: 'not_found' }
  | { kind: 'invalid' };

/**
 * Resolve o download. Para addon, devolve uma URL **do próprio app** que faz o proxy do arquivo.
 *
 * O cliente nunca manda a URL de destino: ele manda fonte + id, e o servidor reencontra a legenda
 * numa busca cacheada. Isso evita que o endpoint vire um proxy aberto (SSRF) — o servidor só fala
 * com hosts que ele mesmo já usou.
 */
export const resolveSubtitleDownload = async (payload: SubtitleDownloadPayload): Promise<SubtitleDownloadResolution> => {
  if (payload.fileId !== undefined) {
    if (!Number.isInteger(payload.fileId)) return { kind: 'invalid' };
    if (!openSubtitlesEnabled()) return { kind: 'invalid' };
    const { url, remaining } = await requestSubtitleDownload(payload.fileId);
    return { kind: 'link', url, remaining };
  }

  if (!payload.source || !payload.id) return { kind: 'invalid' };

  const imdbId = await resolveImdbId({ imdbId: payload.imdbId, tmdbId: undefined, mediaType: payload.mediaType });
  if (!imdbId) return { kind: 'not_found' };

  const type = payload.mediaType === 'tv' ? 'series' : 'movie';
  const contentId = addonContentId(imdbId, payload.season, payload.episode);

  for (const baseUrl of config.subtitles.addons) {
    let manifestName: string;
    try {
      manifestName = (await fetchManifest(baseUrl)).name || baseUrl;
    } catch {
      continue;
    }
    if (manifestName !== payload.source && baseUrl !== payload.source) continue;

    const found = await fetchAddonSubtitles(baseUrl, type, contentId).catch(() => []);
    const match = found.find((s) => s.id === payload.id);
    if (!match) continue;

    const params = new URLSearchParams({ source: baseUrl, id: match.id, imdbId, type });
    if (payload.season && payload.episode) {
      params.set('season', String(payload.season));
      params.set('episode', String(payload.episode));
    }
    return { kind: 'proxy', url: `/api/subtitles/file?${params}` };
  }

  return { kind: 'not_found' };
};

/** Resolve a URL real para o proxy — mesma disciplina: host só pode vir do addon configurado. */
export const resolveAddonFileUrl = async (params: {
  source: string;
  id: string;
  imdbId: string;
  type: string;
  season?: number | null;
  episode?: number | null;
}): Promise<string | null> => {
  const baseUrl = config.subtitles.addons.find((a) => a === params.source);
  if (!baseUrl) return null;
  const contentId = addonContentId(params.imdbId, params.season, params.episode);
  const type = params.type === 'series' ? 'series' : 'movie';
  const found = await fetchAddonSubtitles(baseUrl, type, contentId).catch(() => []);
  return found.find((s) => s.id === params.id)?.url ?? null;
};
