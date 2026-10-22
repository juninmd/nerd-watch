/**
 * Interpreta o `Range`. Devolve `null` para "sem range" (200 no arquivo inteiro) e `'unsatisfiable'`
 * quando o range é sintaticamente válido mas não pode ser servido (416).
 *
 * Cobre o que o player realmente manda: `bytes=N-`, `bytes=N-M` e `bytes=-N` (últimos N bytes, que é
 * como vários navegadores leem o fim de um MP4 para achar o átomo `moov`). Range invertido
 * (`bytes=500-100`) passa na sintaxe mas não é satisfazível — sem essa guarda a resposta saía com
 * 206, `Content-Range` inválido e `Content-Length` negativo.
 */
export const parseRange = (
  header: string | undefined,
  totalSize: number,
): { start: number; end: number } | 'unsatisfiable' | null => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // Sufixo: `bytes=-N` são os últimos N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0 || totalSize === 0) return 'unsatisfiable';
    return { start: Math.max(0, totalSize - suffix), end: totalSize - 1 };
  }

  const start = Number(rawStart);
  if (start >= totalSize) return 'unsatisfiable';
  const end = rawEnd === '' ? totalSize - 1 : Math.min(Number(rawEnd), totalSize - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
};
