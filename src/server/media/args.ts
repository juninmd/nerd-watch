import path from 'node:path';

/**
 * Montagem dos argumentos do ffmpeg/ffprobe. Regras de segurança desta camada:
 * - Só recebe números validados, enums fechados e caminhos ABSOLUTOS que o servidor já resolveu (realpath dentro de
 *   uma raiz). Nenhum texto vindo da requisição chega a uma flag, filtro ou caminho.
 * - O arquivo de entrada é sempre o elemento logo após `-i`, sem shell e sem `-` na frente.
 * - `-protocol_whitelist file` impede que o ffmpeg abra `http:`, `concat:`, `subfile:` etc.
 * - A saída é sempre um nome gerado pelo servidor dentro do cache (`.part`) ou `pipe:1`.
 */

const BASE = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file'];

const assertInput = (file: string): void => {
  if (!path.isAbsolute(file) || file.includes('\0') || file.startsWith('-'))
    throw new Error('caminho de entrada inválido');
};

const assertIndex = (n: number, max = 999): number => {
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error('índice de stream inválido');
  return n;
};

const seconds = (n: number): string => {
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error('posição inválida');
  return n.toFixed(3);
};

/** Filtro fixo: desentrelaça só quando o plano pede, e limita a altura a 1080 mantendo a proporção (largura par). */
const LIVE_FILTER = "scale=-2:'min(1080,ih)'";
const DEINTERLACE_FILTER = 'yadif=mode=send_frame:parity=auto:deint=all';

export const probeArgs = (file: string): string[] => {
  assertInput(file);
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-probesize',
    '32M',
    '-analyzeduration',
    '30M',
    '-protocol_whitelist',
    'file',
    '-i',
    file,
  ];
};

export interface RemuxOptions {
  input: string;
  /** Arquivo temporário gerado pelo servidor (termina em `.part`). */
  output: string;
  videoStreamIndex: number;
  audioOrdinal: number | null;
  audio: 'copy' | 'aac' | 'none';
}

/** Copia o vídeo, copia ou converte o áudio, e grava MP4 com `faststart` (o `moov` no início, para tocar sem baixar tudo). */
export const remuxArgs = (o: RemuxOptions): string[] => {
  assertInput(o.input);
  if (!path.isAbsolute(o.output) || !o.output.endsWith('.part')) throw new Error('saída inválida');
  const map = ['-map', `0:${assertIndex(o.videoStreamIndex)}`];
  const withAudio = o.audioOrdinal !== null && o.audio !== 'none';
  if (withAudio) map.push('-map', `0:a:${assertIndex(o.audioOrdinal as number)}`);
  const audioCodec = !withAudio
    ? []
    : o.audio === 'copy'
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];
  return [
    ...BASE,
    '-i',
    o.input,
    ...map,
    '-c:v',
    'copy',
    ...audioCodec,
    '-sn',
    '-dn',
    '-y',
    '-progress',
    'pipe:1',
    '-f',
    'mp4',
    '-movflags',
    '+faststart',
    o.output,
  ];
};

export interface LiveOptions {
  input: string;
  startSeconds: number;
  videoStreamIndex: number;
  audioOrdinal: number | null;
  deinterlace: boolean;
}

/**
 * Recodifica para H.264 (yuv420p, veryfast, CRF 23, teto de 4 Mb/s) + AAC estéreo, em MP4 fragmentado no stdout.
 * `-ss` antes de `-i` é seek de entrada: o relógio do stream recomeça em 0 na posição pedida (o cliente soma o offset).
 */
export const liveArgs = (o: LiveOptions): string[] => {
  assertInput(o.input);
  const audio =
    o.audioOrdinal === null
      ? ['-an']
      : ['-map', `0:a:${assertIndex(o.audioOrdinal)}`, '-c:a', 'aac', '-b:a', '160k', '-ac', '2'];
  const filter = o.deinterlace ? `${DEINTERLACE_FILTER},${LIVE_FILTER}` : LIVE_FILTER;
  return [
    ...BASE,
    '-ss',
    seconds(o.startSeconds),
    '-i',
    o.input,
    '-map',
    `0:${assertIndex(o.videoStreamIndex)}`,
    ...audio,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-maxrate',
    '4M',
    '-bufsize',
    '8M',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    filter,
    '-sn',
    '-dn',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
};

/** Uma legenda de texto para WebVTT no stdout. */
export const subtitleArgs = (input: string, ordinal: number): string[] => {
  assertInput(input);
  return [...BASE, '-i', input, '-map', `0:s:${assertIndex(ordinal)}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'];
};

/** Índice de trilha vindo da query: só dígitos, até dois. Qualquer outra coisa vira `undefined` (usa o padrão). */
export const parseOrdinal = (raw: string | undefined): number | undefined =>
  raw !== undefined && /^\d{1,2}$/.test(raw) ? Number(raw) : undefined;

/**
 * Posição de início pedida pelo cliente, limitada ao intervalo do vídeo. Negativa, vazia ou NaN vira 0. Quando a
 * duração é conhecida, nunca passa do fim (um seek além do fim reabriria o início, por isso fica meio segundo antes).
 */
export const normalizeStart = (raw: string | undefined, durationSeconds: number | null): number => {
  const value = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  if (durationSeconds === null || durationSeconds <= 0) return value;
  return value >= durationSeconds ? Math.max(0, durationSeconds - 0.5) : value;
};
