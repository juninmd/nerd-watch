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
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** Lê o corpo como texto com teto de bytes: um servidor que manda gigabytes de XML não derruba o processo. */
export const readTextLimited = async (res: Response, maxBytes: number): Promise<string> => {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('resposta grande demais');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let reads = 0; reads < 100_000; reads++) {
    const { done, value } = await reader.read();
    if (done) return new TextDecoder().decode(Buffer.concat(chunks));
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('resposta grande demais');
    }
    chunks.push(value);
  }
  await reader.cancel();
  throw new Error('resposta com chunks demais');
};
