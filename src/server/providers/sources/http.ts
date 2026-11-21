import type { FetchFn } from '../oauth/client.ts';

/** Miniatura: 2 MB no máximo (o `saveThumb` ainda valida jpeg/png). */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const RANGE_RE = /^bytes=\d*-\d*$/;

/** `Range` do navegador repassado só se for `bytes=a-b`; qualquer outro valor é descartado em vez de chegar ao upstream. */
export const safeRange = (range: string | undefined): string | undefined => (range && RANGE_RE.test(range) ? range : undefined);

let plain: FetchFn = (input, init) => fetch(input, init);

/** Pedido sem credencial: só para links pré-autenticados do serviço (nunca leva `Authorization`). */
export const plainFetch: FetchFn = (input, init) => plain(input, init);

export const setPlainFetchForTests = (next?: FetchFn): void => {
  plain = next ?? ((input, init) => fetch(input, init));
};

export const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Lê o corpo até `maxBytes`; passou do teto ou caiu no meio, cancela e devolve null (nunca guarda um arquivo grande na memória). */
export const readCapped = async (res: Response, maxBytes: number): Promise<Uint8Array | null> => {
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/** Só `http:`/`https:`, sem `usuário:senha@` na URL (a credencial vai no campo próprio, nunca na URL). Devolve null se inválida. */
export const cleanHttpUrl = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  return url;
};

export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Timeout só até os cabeçalhos: um vídeo grande leva minutos para terminar de transmitir e não pode ser cortado
 * no meio. Depois que a resposta chega o temporizador é desarmado.
 */
export const fetchHeaders = async (doFetch: Fetcher, url: string | URL, init: RequestInit, ms: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** Lê o corpo como texto com teto de bytes: um servidor que manda gigabytes de XML não derruba o processo. */
export const readTextLimited = async (res: Response, maxBytes: number): Promise<string> => {
  const declaredHeader = res.headers.get('content-length');
  const declared = declaredHeader === null ? Number.NaN : Number(declaredHeader);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error('resposta grande demais');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let reads = 0; reads < 100_000; reads++) {
      const { done, value } = await reader.read();
      if (done) return new TextDecoder().decode(Buffer.concat(chunks));
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error('resposta grande demais');
      }
      chunks.push(value);
    }
    await reader.cancel().catch(() => undefined);
    throw new Error('resposta com chunks demais');
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
};
