import { checkResolvedHost } from '../../subtitles/load.ts';
import { isFetchableSubtitleUrl } from '../../subtitles/url-guard.ts';
import { type FetchFn, fetchCapped, makeFetch } from '../public-http.ts';
import { cachedAddonJson, clearAddonCache } from './cache.ts';

/** Resposta de addon é JSON pequeno; acima disso é abuso (ou addon quebrado). */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type AddonFailure = 'untrusted_url' | 'unreachable' | 'timeout' | 'http_status' | 'too_large' | 'not_json';

/** Mensagens fixas: o texto cru do addon ou da rede não vai para a interface. */
export class AddonError extends Error {
  constructor(
    readonly failure: AddonFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AddonError';
  }
}

const fetcher = makeFetch();
/** Só para teste. Trocar o `fetch` também limpa o cache: o caso de teste quer ver a resposta nova. */
export const setAddonFetch = (next?: FetchFn): void => {
  fetcher.set(next);
  clearAddonCache();
};

/** GET JSON com teto de bytes e de tempo, redirect manual (cada salto passa pela mesma barreira de host público). */
const fetchAddonJson = async (rawUrl: string): Promise<unknown> => {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableSubtitleUrl(current)) {
      throw new AddonError('untrusted_url', 'endereço do addon não é um site público');
    }
    const resolved = await checkResolvedHost(current);
    if (resolved === 'private') {
      throw new AddonError('untrusted_url', 'endereço do addon não é um site público');
    }
    if (resolved !== 'public') {
      throw new AddonError('unreachable', 'não foi possível conectar ao addon');
    }
    let res: Awaited<ReturnType<typeof fetchCapped>>;
    try {
      res = await fetchCapped(fetcher.get(), current, { headers: { accept: 'application/json' } }, TIMEOUT_MS, MAX_BYTES);
    } catch (err) {
      const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
      throw new AddonError(aborted ? 'timeout' : 'unreachable', aborted ? 'o addon demorou demais para responder' : 'não foi possível conectar ao addon');
    }
    if (REDIRECT_STATUS.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new AddonError('http_status', 'o addon respondeu um redirecionamento inválido');
      try {
        current = new URL(location, current).href;
      } catch {
        throw new AddonError('http_status', 'o addon respondeu um redirecionamento inválido');
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new AddonError('http_status', `o addon respondeu ${res.status}`);
    if (!res.bytes) throw new AddonError('too_large', 'a resposta do addon é grande demais');
    try {
      return JSON.parse(new TextDecoder().decode(res.bytes));
    } catch {
      throw new AddonError('not_json', 'a resposta do addon não é JSON');
    }
  }
  throw new AddonError('http_status', 'redirecionamentos demais');
};

/**
 * Entrada usada por todo o protocolo: a mesma URL não vira requisição de novo dentro do TTL que o
 * addon pediu (`cacheMaxAge`), com teto de 5 min. Erro nunca entra no cache.
 */
export const getAddonJson = (rawUrl: string): Promise<unknown> => cachedAddonJson(rawUrl, fetchAddonJson);
