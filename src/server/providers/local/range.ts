import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
};

export const mimeOf = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

export type ByteRange = { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' };

const SINGLE = /^bytes=(\d*)-(\d*)$/;

/**
 * Um intervalo `bytes=a-b`, `bytes=a-` ou `bytes=-n` (sufixo). Qualquer outra forma (várias faixas, outra unidade, faixa
 * fora do arquivo) é 416: o app só pede uma faixa por vez e a alternativa de ignorar o Range mandaria o arquivo inteiro.
 */
export const parseRange = (header: string | undefined, size: number): ByteRange => {
  if (!header) return { kind: 'full' };
  const match = SINGLE.exec(header.trim());
  if (!match || size === 0) return { kind: 'unsatisfiable' };
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return { kind: 'unsatisfiable' };
  // Números enormes são válidos e se limitam ao tamanho do arquivo (RFC 9110), não viram 416.
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return { kind: 'unsatisfiable' };
  if (to === '') return { kind: 'partial', start, end: size - 1 };
  const end = Number(to);
  if (end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(end, size - 1) };
};

/** Serve o arquivo do disco em stream (`Bun.file().slice`), nunca carregado na memória. */
export const serveFile = async (file: string, range: string | undefined): Promise<Response> => {
  const { size } = await stat(file);
  const parsed = parseRange(range, size);
  const common = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes' };
  if (parsed.kind === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${size}` } });
  const blob = Bun.file(file);
  if (parsed.kind === 'full') return new Response(blob, { status: 200, headers: { ...common, 'Content-Length': String(size) } });
  const length = parsed.end - parsed.start + 1;
  return new Response(blob.slice(parsed.start, parsed.end + 1), {
    status: 206,
    headers: { ...common, 'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`, 'Content-Length': String(length) },
  });
};
