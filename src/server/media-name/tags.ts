/**
 * Vocabulário de tags de release (resolução, codec, fonte, áudio, idioma). Tudo é casado na forma "folded"
 * (sem acento, minúscula), então "Áudio", "áudio" e "audio" são a mesma palavra.
 */
export type Resolution = '480p' | '576p' | '720p' | '1080p' | '2160p';
export type Source = 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'HDRip' | 'DVD' | 'CAM';
export type Codec = 'H.264' | 'H.265' | 'AV1' | 'VP9' | 'XviD' | 'DivX';
export type AudioMode = 'dubbed' | 'subtitled' | 'dual';

export type TagHit =
  | { kind: 'resolution'; value: Resolution }
  | { kind: 'codec'; value: Codec }
  | { kind: 'source'; value: Source }
  | { kind: 'audio'; value: AudioMode }
  | { kind: 'lang'; value: string }
  | { kind: 'special' }
  | { kind: 'noise' };

export interface TagMatch {
  hit: TagHit;
  /** Palavra comum demais para ser tag sozinha ("Dual", "Extra", "CAM"): só conta depois do título. */
  ambiguous: boolean;
  /** Quantas palavras a tag ocupa ("dual audio" = 2). */
  span: number;
}

export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const RESOLUTION_HEIGHTS: ReadonlySet<number> = new Set([480, 576, 720, 1080, 2160]);

const entry = (hit: TagHit, ambiguous = false) => ({ hit, ambiguous });

const SINGLE: Record<string, ReturnType<typeof entry>> = {
  '480p': entry({ kind: 'resolution', value: '480p' }),
  '576p': entry({ kind: 'resolution', value: '576p' }),
  '720p': entry({ kind: 'resolution', value: '720p' }),
  '1080p': entry({ kind: 'resolution', value: '1080p' }),
  '2160p': entry({ kind: 'resolution', value: '2160p' }),
  '4k': entry({ kind: 'resolution', value: '2160p' }),
  uhd: entry({ kind: 'resolution', value: '2160p' }),

  x264: entry({ kind: 'codec', value: 'H.264' }),
  h264: entry({ kind: 'codec', value: 'H.264' }),
  'h.264': entry({ kind: 'codec', value: 'H.264' }),
  avc: entry({ kind: 'codec', value: 'H.264' }),
  x265: entry({ kind: 'codec', value: 'H.265' }),
  h265: entry({ kind: 'codec', value: 'H.265' }),
  'h.265': entry({ kind: 'codec', value: 'H.265' }),
  hevc: entry({ kind: 'codec', value: 'H.265' }),
  av1: entry({ kind: 'codec', value: 'AV1' }),
  vp9: entry({ kind: 'codec', value: 'VP9' }),
  xvid: entry({ kind: 'codec', value: 'XviD' }),
  divx: entry({ kind: 'codec', value: 'DivX' }),

  bluray: entry({ kind: 'source', value: 'BluRay' }),
  'blu-ray': entry({ kind: 'source', value: 'BluRay' }),
  bdrip: entry({ kind: 'source', value: 'BluRay' }),
  brrip: entry({ kind: 'source', value: 'BluRay' }),
  'web-dl': entry({ kind: 'source', value: 'WEB-DL' }),
  webdl: entry({ kind: 'source', value: 'WEB-DL' }),
  webrip: entry({ kind: 'source', value: 'WEBRip' }),
  'web-rip': entry({ kind: 'source', value: 'WEBRip' }),
  hdtv: entry({ kind: 'source', value: 'HDTV' }),
  hdrip: entry({ kind: 'source', value: 'HDRip' }),
  dvdrip: entry({ kind: 'source', value: 'DVD' }),
  dvdscr: entry({ kind: 'source', value: 'DVD' }),
  hdcam: entry({ kind: 'source', value: 'CAM' }),
  camrip: entry({ kind: 'source', value: 'CAM' }),
  cam: entry({ kind: 'source', value: 'CAM' }, true),
  dvd: entry({ kind: 'source', value: 'DVD' }, true),

  dublado: entry({ kind: 'audio', value: 'dubbed' }),
  dublada: entry({ kind: 'audio', value: 'dubbed' }),
  dublados: entry({ kind: 'audio', value: 'dubbed' }),
  dubladas: entry({ kind: 'audio', value: 'dubbed' }),
  dublagem: entry({ kind: 'audio', value: 'dubbed' }),
  dubbed: entry({ kind: 'audio', value: 'dubbed' }),
  dub: entry({ kind: 'audio', value: 'dubbed' }, true),
  legendado: entry({ kind: 'audio', value: 'subtitled' }),
  legendada: entry({ kind: 'audio', value: 'subtitled' }),
  legendados: entry({ kind: 'audio', value: 'subtitled' }),
  legendadas: entry({ kind: 'audio', value: 'subtitled' }),
  legendas: entry({ kind: 'audio', value: 'subtitled' }),
  subbed: entry({ kind: 'audio', value: 'subtitled' }),
  subtitled: entry({ kind: 'audio', value: 'subtitled' }),
  dual: entry({ kind: 'audio', value: 'dual' }, true),

  'pt-br': entry({ kind: 'lang', value: 'pt-BR' }),
  nacional: entry({ kind: 'lang', value: 'pt-BR' }, true),
  ingles: entry({ kind: 'lang', value: 'en' }),
  english: entry({ kind: 'lang', value: 'en' }, true),
  eng: entry({ kind: 'lang', value: 'en' }, true),
  japones: entry({ kind: 'lang', value: 'ja' }),
  japanese: entry({ kind: 'lang', value: 'ja' }, true),
  espanhol: entry({ kind: 'lang', value: 'es' }),
  castelhano: entry({ kind: 'lang', value: 'es' }),
  spanish: entry({ kind: 'lang', value: 'es' }, true),

  especial: entry({ kind: 'special' }, true),
  especiais: entry({ kind: 'special' }, true),
  special: entry({ kind: 'special' }, true),
  specials: entry({ kind: 'special' }, true),
  extra: entry({ kind: 'special' }, true),
  extras: entry({ kind: 'special' }, true),
  ova: entry({ kind: 'special' }, true),
  ovas: entry({ kind: 'special' }, true),
  ona: entry({ kind: 'special' }, true),
  onas: entry({ kind: 'special' }, true),
  oav: entry({ kind: 'special' }, true),

  extended: entry({ kind: 'noise' }, true),
  '10bit': entry({ kind: 'noise' }),
  '8bit': entry({ kind: 'noise' }),
  hdr: entry({ kind: 'noise' }),
  hdr10: entry({ kind: 'noise' }),
  dv: entry({ kind: 'noise' }),
  dolbyvision: entry({ kind: 'noise' }),
  aac: entry({ kind: 'noise' }),
  ac3: entry({ kind: 'noise' }),
  eac3: entry({ kind: 'noise' }),
  ddp: entry({ kind: 'noise' }),
  dts: entry({ kind: 'noise' }),
  flac: entry({ kind: 'noise' }),
  opus: entry({ kind: 'noise' }),
  remux: entry({ kind: 'noise' }),
  proper: entry({ kind: 'noise' }),
  repack: entry({ kind: 'noise' }),
  uncut: entry({ kind: 'noise' }),
  unrated: entry({ kind: 'noise' }),
  imax: entry({ kind: 'noise' }),
  multi: entry({ kind: 'noise' }),
  amzn: entry({ kind: 'noise' }),
  nf: entry({ kind: 'noise' }),
  dsnp: entry({ kind: 'noise' }),
  hmax: entry({ kind: 'noise' }),
  atvp: entry({ kind: 'noise' }),
  '5.1': entry({ kind: 'noise' }),
  '7.1': entry({ kind: 'noise' }),
  '2.0': entry({ kind: 'noise' }),
};

/** Duas palavras que juntas formam uma tag ("WEB DL", "Dual Áudio", "PT BR" depois de trocar o separador). */
const PAIRS: Record<string, ReturnType<typeof entry>> = {
  'web dl': entry({ kind: 'source', value: 'WEB-DL' }),
  'web rip': entry({ kind: 'source', value: 'WEBRip' }),
  'blu ray': entry({ kind: 'source', value: 'BluRay' }),
  'dual audio': entry({ kind: 'audio', value: 'dual' }),
  'pt br': entry({ kind: 'lang', value: 'pt-BR' }),
};

const resolutionFromSize = (word: string): ReturnType<typeof entry> | undefined => {
  const m = /^\d{3,4}x(\d{3,4})$/.exec(word);
  if (!m) return undefined;
  const height = Number(m[1]);
  return RESOLUTION_HEIGHTS.has(height) ? entry({ kind: 'resolution', value: `${height}p` as Resolution }) : undefined;
};

/** Classifica a palavra em `i` (com lookahead de pares). `words` já vem folded. Null quando não é tag. */
export const classifyAt = (words: readonly string[], i: number): TagMatch | null => {
  const word = words[i];
  if (word === undefined) return null;
  const next = words[i + 1];
  if (next !== undefined) {
    const pair = PAIRS[`${word} ${next}`];
    if (pair) return { ...pair, span: 2 };
  }
  const single = SINGLE[word] ?? resolutionFromSize(word);
  return single ? { ...single, span: 1 } : null;
};
