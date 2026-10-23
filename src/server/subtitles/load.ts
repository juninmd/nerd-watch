import { decodeSubtitleBytes } from '../../shared/subtitles/decode.ts';
import { toWebVtt } from '../../shared/subtitles/srt-vtt.ts';
import { type FetchFn, fetchCapped, makeFetch } from '../providers/public-http.ts';
import { lookup } from 'node:dns/promises';
import { isFetchableSubtitleUrl, isIpLiteral, isPublicAddress } from './url-guard.ts';

/** Resolve um nome para os endereços dele. Trocado em teste; produção usa o DNS do sistema. */
export type HostResolver = (host: string) => Promise<string[]>;
const systemResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
let hostResolver: HostResolver = systemResolver;
export const setHostResolver = (next?: HostResolver): void => {
  hostResolver = next ?? systemResolver;
};

type HostCheck = 'public' | 'private' | 'unresolved';

/** Todo endereço que o nome resolve tem que ser público; um só privado reprova. Literal IP já foi checado. */
const checkResolvedHost = async (rawUrl: string): Promise<HostCheck> => {
  const host = new URL(rawUrl).hostname.toLowerCase().replace(/^[|]$/g, '').replace(/.$/, '');
  if (isIpLiteral(host)) return 'public';
  let addresses: string[];
  try {
    addresses = await hostResolver(host);
  } catch {
    return 'unresolved';
  }
  if (addresses.length === 0) return 'unresolved';
  return addresses.every(isPublicAddress) ? 'public' : 'private';
};

/** Legenda de filme inteiro cabe folgada nisso (SRT de 3 h tem uns 300 KB). Acima disso não é legenda. */
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Tipos que addons e arquivos de legenda usam na prática. Vazio é aceito: muitos servem sem Content-Type. */
const ALLOWED_TYPES = new Set([
  '',
  'text/plain',
  'text/vtt',
  'text/srt',
  'text/x-subrip',
  'application/x-subrip',
  'text/x-ssa',
  'text/x-ass',
  'application/x-ass',
  'application/ass',
  'application/ssa',
  'application/x-ssa',
  'application/octet-stream',
]);

export type SubtitleFailure =
  | 'untrusted_url'
  | 'too_many_redirects'
  | 'unreachable'
  | 'http_status'
  | 'too_large'
  | 'bad_type';

export type SubtitleBytes = { ok: true; bytes: Uint8Array } | { ok: false; reason: SubtitleFailure };

export type SubtitleVttLoad =
  | { ok: true; vtt: string; cues: number }
  | { ok: false; reason: SubtitleFailure | 'empty' | 'no_cues' };

const mediaType = (headers: Headers): string =>
  (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/**
 * Baixa o arquivo de legenda. Redirecionamento é seguido à mão para que cada destino passe pela checagem de
 * host antes de a conexão sair; um 302 para 127.0.0.1 falha aqui, e não depois de a requisição já ter ido.
 */
export const fetchSubtitleBytes = async (
  startUrl: string,
  fetchFn: FetchFn = makeFetch().get(),
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<SubtitleBytes> => {
  let current = startUrl;
  // Um prazo para a cadeia inteira: três saltos de 15 s não podem virar 60 s de espera.
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableSubtitleUrl(current)) return { ok: false, reason: 'untrusted_url' };
    const check = await checkResolvedHost(current);
    if (check === 'unresolved') return { ok: false, reason: 'unreachable' };
    if (check === 'private') return { ok: false, reason: 'untrusted_url' };
    let res: Awaited<ReturnType<typeof fetchCapped>>;
    try {
      res = await fetchCapped(
        fetchFn,
        current,
        { headers: { accept: 'text/plain, text/vtt, application/x-subrip, */*;q=0.1' } },
        Math.max(1, deadline - Date.now()),
        MAX_SUBTITLE_BYTES,
      );
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (REDIRECT_STATUS.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, reason: 'http_status' };
      try {
        current = new URL(location, current).href;
      } catch {
        return { ok: false, reason: 'untrusted_url' };
      }
      continue;
    }
    if (res.status < 200 || res.status > 299) return { ok: false, reason: 'http_status' };
    if (res.bytes === null) return { ok: false, reason: 'too_large' };
    if (!ALLOWED_TYPES.has(mediaType(res.headers))) return { ok: false, reason: 'bad_type' };
    return { ok: true, bytes: res.bytes };
  }
  return { ok: false, reason: 'too_many_redirects' };
};

/** Baixa, decodifica (UTF-8 ou Windows-1252) e converte para WebVTT. Nada do HTML de erro da fonte sai daqui. */
export const loadSubtitleAsVtt = async (url: string, fetchFn?: FetchFn): Promise<SubtitleVttLoad> => {
  const got = await fetchSubtitleBytes(url, fetchFn);
  if (!got.ok) return got;
  const converted = toWebVtt(decodeSubtitleBytes(got.bytes));
  if (!converted.ok) return converted;
  return { ok: true, vtt: converted.vtt, cues: converted.cues };
};
