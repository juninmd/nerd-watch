export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const realFetch: FetchFn = (input, init) => fetch(input, init);

/** Permite trocar o `fetch` nos testes; nunca usado em produção. */
export const makeFetch = (override?: FetchFn): { get(): FetchFn; set(next?: FetchFn): void } => {
  let current: FetchFn = override ?? realFetch;
  return {
    get: () => current,
    set: (next) => {
      current = next ?? realFetch;
    },
  };
};

/**
 * Mídia de vídeo: o tempo limite vale só até os cabeçalhos. Um filme de 2 GB não pode ser cortado no meio
 * do corpo por um `AbortSignal.timeout` que continua correndo durante o stream.
 */
export const fetchHeaders = async (fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export interface CappedResponse {
  status: number;
  headers: Headers;
  /** Null quando o corpo passa do limite (o corpo é descartado, nunca guardado pela metade). */
  bytes: Uint8Array | null;
}

/** Lê uma resposta pequena (JSON, HTML, XML, miniatura) com teto de bytes e tempo limite que cobre o corpo inteiro. */
export const fetchCapped = async (fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number, maxBytes: number): Promise<CappedResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, redirect: 'manual', signal: controller.signal });
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { status: res.status, headers: res.headers, bytes: null };
    }
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, headers: res.headers, bytes: new Uint8Array() };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { status: res.status, headers: res.headers, bytes: null };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: res.status, headers: res.headers, bytes };
  } finally {
    clearTimeout(timer);
  }
};
