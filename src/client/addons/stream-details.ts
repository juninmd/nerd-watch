import type { AddonStreamDto } from '../api/stremio.ts';

export type BadgeTone = 'accent' | 'neutral' | 'warn';

export interface StreamBadge {
  label: string;
  tone: BadgeTone;
}

export interface StreamDetails {
  /** Cabeçalho curto do card (ex.: `Torrentio · 1080p` ou título resumido). */
  heading: string;
  /** Linhas extras da descrição do addon (sem repetir o cabeçalho). */
  lines: string[];
  /** Selos estruturados: resolução, fonte, HDR/codec, áudio, idioma, tamanho, seeds, tipo, avisos. */
  badges: StreamBadge[];
  /** Metadados técnicos de rodapé (arquivo, container, fileIdx, trackers, domínio, regiões). */
  meta: string[];
}

export const formatStreamBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  const num = val >= 100 ? String(Math.round(val)) : val.toFixed(2).replace(/\.?0+$/, '');
  return `${num} ${units[i]}`;
};

const matchFirst = (haystack: string, rules: Array<[RegExp, string]>): string | null => {
  for (const [re, label] of rules) {
    if (re.test(haystack)) return label;
  }
  return null;
};

const RESOLUTIONS: Array<[RegExp, string]> = [
  [/\b(2160p|4k|uhd)\b/i, '4K'],
  [/\b1080p\b/i, '1080p'],
  [/\b720p\b/i, '720p'],
  [/\b(480p|576p|sd)\b/i, '480p'],
  [/\b(cam|hdcam|ts|telesync)\b/i, 'CAM'],
];

const SOURCES: Array<[RegExp, string]> = [
  [/\bremux\b/i, 'REMUX'],
  [/\b(blu-?ray|bdrip|brrip)\b/i, 'BluRay'],
  [/\bweb-?dl\b/i, 'WEB-DL'],
  [/\bwebrip\b/i, 'WEBRip'],
  [/\bhdrip\b/i, 'HDRip'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\bdvdrip\b/i, 'DVDRip'],
];

const HDR: Array<[RegExp, string]> = [
  [/\b(dolby[\s.-]?vision|dovi|\bdv\b)\b/i, 'Dolby Vision'],
  [/\bhdr10\+/i, 'HDR10+'],
  [/\bhdr10\b/i, 'HDR10'],
  [/\bhdr\b/i, 'HDR'],
];

const CODECS: Array<[RegExp, string]> = [
  [/\bav1\b/i, 'AV1'],
  [/\b(hevc|x265|h\.?265)\b/i, 'HEVC'],
  [/\b(x264|h\.?264|avc)\b/i, 'H.264'],
];

const AUDIO: Array<[RegExp, string]> = [
  [/\batmos\b/i, 'Atmos'],
  [/\btruehd\b/i, 'TrueHD'],
  [/\bdts-?hd(?:\s*ma)?\b/i, 'DTS-HD'],
  [/\bdts\b/i, 'DTS'],
  [/\b(ddp|dd\+|e-?ac-?3)\b/i, 'DD+'],
  [/\b(dd5\.1|ac-?3)\b/i, 'DD 5.1'],
  [/\baac\b/i, 'AAC'],
];

const LANGS: Array<[RegExp, string]> = [
  [/\b(dual[\s.-]?[aá]udio|dual)\b/i, 'Dual Áudio'],
  [/\b(dublado|pt-?br|portugu[eê]s|nacional)\b|🇧🇷/i, 'PT-BR'],
  [/\b(multi(?:[\s.-]?audio)?)\b/i, 'Multi'],
  [/\b(legendado|leg)\b/i, 'Legendado'],
];

const KIND_LABEL: Record<AddonStreamDto['kind'], string> = {
  url: 'Direto',
  torrent: 'P2P Torrent',
  youtube: 'YouTube',
  external: 'Externo',
  error: 'Aviso',
};

const extractSize = (text: string, videoSize?: number | null): string | null => {
  if (videoSize && videoSize > 0) return formatStreamBytes(videoSize);
  const m = /(?:💾\s*)?(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i.exec(text);
  return m ? `${m[1]?.replace(',', '.')} ${m[2]?.toUpperCase()}` : null;
};

const extractSeeds = (text: string): number | null => {
  const m = /(?:👤|seeds?:?|s:)\s*(\d{1,6})\b/i.exec(text);
  return m ? Number(m[1]) : null;
};

const urlHost = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
};

const fileExt = (filename: string | null): string | null => {
  if (!filename) return null;
  const m = /\.([a-z0-9]{2,5})$/i.exec(filename.trim());
  return m ? m[1]?.toUpperCase() ?? null : null;
};

/**
 * Extrai todos os detalhes estruturados de um stream do Stremio (resolução, fonte, HDR/codec, áudio,
 * idioma, tamanho, seeds, legendas embutidas, arquivo, trackers e avisos de compatibilidade).
 */
export const parseStreamDetails = (s: AddonStreamDto): StreamDetails => {
  const name = (s.name ?? '').trim();
  const desc = (s.description ?? '').trim();
  const haystack = [name, desc, s.filename ?? '', s.bingeGroup ?? ''].filter(Boolean).join('\n');

  const badges: StreamBadge[] = [];
  const push = (label: string | null, tone: BadgeTone = 'neutral') => {
    if (label && !badges.some((b) => b.label.toLowerCase() === label.toLowerCase())) {
      badges.push({ label, tone });
    }
  };

  push(matchFirst(haystack, RESOLUTIONS), 'accent');
  push(KIND_LABEL[s.kind], s.kind === 'url' ? 'accent' : 'neutral');
  push(matchFirst(haystack, SOURCES));
  push(matchFirst(haystack, HDR));
  push(matchFirst(haystack, CODECS));
  if (/\b10[\s.-]?bit\b/i.test(haystack)) push('10-bit');
  push(matchFirst(haystack, AUDIO));
  for (const [re, label] of LANGS) {
    if (re.test(haystack)) push(label);
  }

  const size = extractSize(haystack, s.videoSize);
  if (size) push(size);

  const seeds = extractSeeds(haystack);
  if (seeds !== null) push(`${seeds} seed${seeds === 1 ? '' : 's'}`);

  if (s.subtitleLangs && s.subtitleLangs.length > 0) {
    push(`Legendas: ${s.subtitleLangs.slice(0, 4).join(', ')}`);
  }

  if (s.notWebReady) {
    push('Pode exigir player externo', 'warn');
  }

  const nameLines = name
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const descLines = desc
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const heading = nameLines.length > 0 ? nameLines.join(' · ') : (descLines[0] ?? s.title);
  const lines = nameLines.length > 0 ? descLines : descLines.slice(1);

  const meta: string[] = [];
  const ext = fileExt(s.filename);
  if (s.filename) meta.push(ext ? `Arquivo: ${s.filename} (${ext})` : `Arquivo: ${s.filename}`);
  if (s.kind === 'torrent') {
    if (s.fileIdx !== null) meta.push(`Índice no pack: #${s.fileIdx}`);
    if (s.trackerCount && s.trackerCount > 0) meta.push(`${s.trackerCount} tracker${s.trackerCount === 1 ? '' : 's'}`);
    if (s.infoHash) meta.push(`Hash: ${s.infoHash.slice(0, 10)}…`);
  } else {
    const host = urlHost(s.url);
    if (host) meta.push(`Servidor: ${host}`);
  }
  if (s.countryWhitelist && s.countryWhitelist.length > 0) {
    meta.push(`Regiões: ${s.countryWhitelist.join(', ')}`);
  }

  return { heading, lines, badges, meta };
};
