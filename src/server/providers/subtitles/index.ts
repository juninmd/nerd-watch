import { config } from '../../config.ts';
import { tmdbExternalIds } from '../tmdb.ts';
import { archiveMovieDetails } from '../archive.ts';
import { isFetchableSubtitleUrl } from '../../subtitles/url-guard.ts';
import { searchSubtitles as searchOpenSubtitlesRest, requestSubtitleDownload, openSubtitlesEnabled } from '../opensubtitles.ts';
import { canonicalLanguage, languageAccepted, languageRank, normalizeLanguage } from './languages.ts';
import { type AddonSubtitle, addonContentId, fetchAddonSubtitles, fetchManifest, supportsSubtitles } from './stremio-addon.ts';
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

/** Por que a busca não está disponível — a interface diz coisas diferentes em cada caso. */
export type SubtitleUnavailableReason = 'no_sources' | 'no_imdb_id';

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
  /** `false` quando não há como buscar — `reason` diz por quê. */
  enabled: boolean;
  reason?: SubtitleUnavailableReason;
  /**
   * Id do IMDb do título. Vai na resposta para o cliente poder pedir o download sem uma segunda
   * tradução — sem isso o painel não teria como montar um pedido válido.
   */
  imdbId: string | null;
}

const acceptedLanguages = (): string[] =>
  config.subtitles.languages
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Resolve o id do IMDb — sem ele nenhum addon responde. */
const resolveImdbId = async (opts: { imdbId?: string; tmdbId?: number; mediaType?: MediaType }): Promise<string | null> => {
  if (opts.imdbId) return opts.imdbId;
  if (!opts.tmdbId || !opts.mediaType) return null;
  try {
    return await tmdbExternalIds(opts.mediaType, opts.tmdbId);
  } catch {
    // TMDB sem chave ou fora do ar: sem imdbId a busca por addon simplesmente não acontece.
    return null;
  }
};

interface AddonSearchOutcome {
  results: SubtitleResult[];
  /** Fontes que responderam, tenham devolvido legenda ou não. */
  responded: string[];
  unavailable: string[];
}

const searchAddons = async (
  imdbId: string,
  type: 'movie' | 'series',
  season?: number | null,
  episode?: number | null,
): Promise<AddonSearchOutcome> => {
  const contentId = addonContentId(imdbId, season, episode);
  const accepted = acceptedLanguages();

  const settled = await Promise.allSettled(
    config.subtitles.addons.map(async (baseUrl) => {
      const manifest = await fetchManifest(baseUrl);
      if (!supportsSubtitles(manifest)) throw new Error(`${manifest.name || baseUrl} não serve legendas`);
      const addonSubtitles = await fetchAddonSubtitles(baseUrl, type, contentId);

      const name = manifest.name || baseUrl;
      return {
        name,
        results: addonSubtitles
          .map((s): SubtitleResult => {
            const lang = normalizeLanguage(s.rawLang);
            return {
              source: name,
              id: s.id,
              languageCode: lang.code,
              language: lang.label,
              release: s.release,
              downloads: null,
              directUrl: s.url,
            };
          })
          .filter((r) => languageAccepted(r.languageCode, accepted))
          .slice(0, PER_SOURCE_LIMIT),
      };
    }),
  );

  const results: SubtitleResult[] = [];
  const responded: string[] = [];
  const unavailable: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      responded.push(outcome.value.name);
      results.push(...outcome.value.results);
    } else {
      unavailable.push(`${config.subtitles.addons[index] ?? 'addon'}: ${outcome.reason?.message ?? outcome.reason}`);
    }
  });
  return { results, responded, unavailable };
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

/** Mesma legenda pode vir repetida de fontes diferentes; `source`+`id` identifica. */
const dedupe = (results: SubtitleResult[]): SubtitleResult[] => {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.source}\u0000${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Ordena pelo idioma preferido (posição exata na configuração) e, dentro dele, por popularidade. */
const sortByPreference = (results: SubtitleResult[]): SubtitleResult[] => {
  const preferred = acceptedLanguages();
  return [...results].sort(
    (a, b) => languageRank(a.languageCode, preferred) - languageRank(b.languageCode, preferred) || (b.downloads ?? 0) - (a.downloads ?? 0),
  );
};

export const searchAllSubtitles = async (opts: SubtitleSearchOptions): Promise<SubtitleSearchOutcome> => {
  const configuredAddons = config.subtitles.addons;
  const restEnabled = openSubtitlesEnabled();

  if (configuredAddons.length === 0 && !restEnabled) {
    return { results: [], sources: [], unavailable: [], enabled: false, reason: 'no_sources', imdbId: null };
  }

  const imdbId = await resolveImdbId(opts);
  if (!imdbId && !restEnabled) {
    // Nenhum addon responde sem id do IMDb (o protocolo só aceita `tt…`), e sem chave a REST
    // também não. Dizer "desligado" aqui mandaria o usuário configurar o que já está configurado.
    return { results: [], sources: [], unavailable: [...configuredAddons], enabled: false, reason: 'no_imdb_id', imdbId: null };
  }

  const unavailable: string[] = [];
  const responded: string[] = [];
  const allResults: SubtitleResult[] = [];
  const jobs: Array<Promise<void>> = [];

  if (imdbId) {
    jobs.push(
      searchAddons(imdbId, opts.mediaType === 'tv' ? 'series' : 'movie', opts.season, opts.episode).then((outcome) => {
        allResults.push(...outcome.results);
        responded.push(...outcome.responded);
        unavailable.push(...outcome.unavailable);
      }),
    );
  }
  if (restEnabled && (opts.tmdbId || opts.query)) {
    jobs.push(
      searchOpenSubtitles(opts).then((found) => {
        if (found.length > 0) responded.push('OpenSubtitles.com');
        allResults.push(...found);
      }),
    );
  }

  const settled = await Promise.allSettled(jobs);
  for (const outcome of settled) {
    if (outcome.status === 'rejected') unavailable.push(String(outcome.reason?.message ?? outcome.reason));
  }

  return {
    results: sortByPreference(dedupe(allResults)),
    sources: [...new Set(responded)],
    unavailable,
    enabled: true,
    imdbId,
  };
};

export interface SubtitleDownloadPayload {
  /** Nome da fonte, como veio no resultado. */
  source?: string;
  id?: string;
  imdbId?: string;
  tmdbId?: number;
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
 * Acha a legenda na lista atual do addon. O servidor reencontra a URL pela fonte e pelo id, e nunca aceita
 * uma URL vinda do cliente.
 */
const findAddonSubtitle = async (
  payload: SubtitleDownloadPayload,
): Promise<{ baseUrl: string; imdbId: string; type: 'movie' | 'series'; match: AddonSubtitle } | null> => {
  if (!payload.source || !payload.id) return null;
  // Aceita o id do IMDb direto (mais barato) ou a dupla tmdbId+mediaType, que é o que a interface
  // tem em mãos. Antes só o primeiro caminho existia, e por isso o painel nunca conseguia baixar.
  const imdbId = await resolveImdbId({ imdbId: payload.imdbId, tmdbId: payload.tmdbId, mediaType: payload.mediaType });
  if (!imdbId) return null;

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
    if (match) return { baseUrl, imdbId, type, match };
  }
  return null;
};

/**
 * Resolve o download. Para addon, devolve uma URL **do próprio app** que faz o proxy do arquivo.
 *
 * O cliente nunca manda a URL de destino: ele manda a fonte e o id, e o servidor reencontra a
 * legenda numa busca cacheada (`id` só escolhe uma entrada da listagem que o servidor já tem).
 */
export const resolveSubtitleDownload = async (payload: SubtitleDownloadPayload): Promise<SubtitleDownloadResolution> => {
  if (payload.fileId !== undefined) {
    if (!Number.isInteger(payload.fileId)) return { kind: 'invalid' };
    if (!openSubtitlesEnabled()) return { kind: 'invalid' };
    const { url, remaining } = await requestSubtitleDownload(payload.fileId);
    return { kind: 'link', url, remaining };
  }

  if (!payload.source || !payload.id) return { kind: 'invalid' };
  const found = await findAddonSubtitle(payload);
  if (!found) return { kind: 'not_found' };

  const params = new URLSearchParams({ source: found.baseUrl, id: found.match.id, imdbId: found.imdbId, type: found.type });
  if (payload.season && payload.episode) {
    params.set('season', String(payload.season));
    params.set('episode', String(payload.episode));
  }
  return { kind: 'proxy', url: `/api/subtitles/file?${params}` };
};

/** Mesmo caminho de `resolveSubtitleDownload`, mas devolve a URL do arquivo para o servidor baixar e converter. */
export const resolveSubtitleFile = async (
  payload: SubtitleDownloadPayload,
): Promise<{ kind: 'file'; url: string } | { kind: 'not_found' } | { kind: 'invalid' }> => {
  if (payload.fileId !== undefined) {
    if (!Number.isInteger(payload.fileId) || !openSubtitlesEnabled()) return { kind: 'invalid' };
    const { url } = await requestSubtitleDownload(payload.fileId);
    return { kind: 'file', url };
  }
  if (!payload.source || !payload.id) return { kind: 'invalid' };
  const found = await findAddonSubtitle(payload);
  return found ? { kind: 'file', url: found.match.url } : { kind: 'not_found' };
};

/** Legenda que o próprio Internet Archive hospeda para o item (cache do detalhe). Null quando o item não tem. */
export const resolveArchiveSubtitleUrl = async (identifier: string): Promise<string | null> =>
  (await archiveMovieDetails(identifier))?.subtitleUrl ?? null;

export { isFetchableSubtitleUrl };

export type AddonFileResolution = { ok: true; url: string } | { ok: false; reason: 'not_found' | 'untrusted_url' | 'source_error' };

/** Resolve a URL real para o proxy — mesma disciplina: a fonte tem que estar na allowlist. */
export const resolveAddonFileUrl = async (params: {
  source: string;
  id: string;
  imdbId: string;
  type: string;
  season?: number | null;
  episode?: number | null;
}): Promise<AddonFileResolution> => {
  const baseUrl = config.subtitles.addons.find((a) => a === params.source);
  if (!baseUrl) return { ok: false, reason: 'source_error' };

  const contentId = addonContentId(params.imdbId, params.season, params.episode);
  const type = params.type === 'series' ? 'series' : 'movie';

  let found: Awaited<ReturnType<typeof fetchAddonSubtitles>>;
  try {
    found = await fetchAddonSubtitles(baseUrl, type, contentId);
  } catch {
    // Distinguir "addon fora do ar" de "legenda não existe" evita um 404 enganoso.
    return { ok: false, reason: 'source_error' };
  }

  const match = found.find((s) => s.id === params.id);
  if (!match) return { ok: false, reason: 'not_found' };
  if (!isFetchableSubtitleUrl(match.url)) return { ok: false, reason: 'untrusted_url' };
  return { ok: true, url: match.url };
};

export { canonicalLanguage };
