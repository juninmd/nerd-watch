/** Teto do arquivo CSV de biblioteca: 1 MiB cobre milhares de títulos com notas; acima disso é erro. */
export const CSV_MAX_BYTES = 1024 * 1024;
/** Teto de linhas de dados por importação: limita o tamanho da transação e do relatório. */
export const CSV_MAX_ROWS = 2000;
/** Teto do XML do MyAnimeList: uma lista grande ocupa poucos MiB; 5 MiB com folga. */
export const MAL_MAX_BYTES = 5 * 1024 * 1024;
export const MAL_MAX_ENTRIES = 5000;

/** Erro de entrada do usuário: carrega o status HTTP que a rota deve devolver (400 ou 413). */
export class InputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

/** Problema de uma linha (CSV) ou entrada (MAL): não derruba o arquivo inteiro. `row` é 1-based. */
export interface RowError {
  row: number;
  message: string;
}

const mib = (bytes: number): string => `${bytes / (1024 * 1024)} MiB`;

/**
 * Lê o corpo como UTF-8 estrito até `maxBytes`. Confere Content-Length antes de ler e, sem ele (stream), conta os bytes
 * e cancela ao passar do teto: nunca guarda mais que o limite na memória.
 */
export const readBodyText = async (req: Request, maxBytes: number): Promise<string> => {
  const declared = Number(req.headers.get('content-length'));
  if (declared > maxBytes) throw new InputError(`arquivo grande demais: o limite é ${mib(maxBytes)}`, 413);
  if (!req.body) return '';

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new InputError(`arquivo grande demais: o limite é ${mib(maxBytes)}`, 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputError('o arquivo não é UTF-8 válido', 400);
  }
};
