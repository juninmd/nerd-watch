import type { FetchFn } from '../oauth/client.ts';

/** Miniatura: 2 MB no máximo (o `saveThumb` ainda valida jpeg/png). */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

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

/** Lê o corpo até `maxBytes`; passou do teto, cancela e devolve null (nunca guarda um arquivo grande na memória). */
export const readCapped = async (res: Response, maxBytes: number): Promise<Uint8Array | null> => {
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
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
