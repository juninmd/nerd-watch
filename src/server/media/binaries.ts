import { existsSync } from 'node:fs';
import type { MediaSettings } from './settings.ts';

export interface Binaries {
  ffmpeg: string;
  ffprobe: string;
}

export type BinaryStatus = { ok: true; bins: Binaries } | { ok: false; reason: string };

/** Como ativar, na mensagem que o usuário vê: o que falta e a variável que resolve. */
const HOW_TO_ENABLE =
  'instale o ffmpeg (com ffprobe) e deixe no PATH, ou aponte FFMPEG_PATH e FFPROBE_PATH; TRANSCODE_ENABLED=auto liga a conversão';

const locate = (explicit: string | undefined, name: string, which: (bin: string) => string | null): string | null => {
  if (explicit) return existsSync(explicit) ? explicit : null;
  return which(name);
};

/**
 * Acha os binários a cada chamada (barato: um `stat` ou uma busca no PATH). Assim um ffmpeg instalado depois do boot
 * passa a valer sem reiniciar, e um apagado some sem derrubar nada. `which` é injetado para os testes.
 */
const ALLOWED_BINARIES_DIR = '/usr/local/bin';

const isTrustedPath = (path: string): boolean => {
  return path.startsWith(ALLOWED_BINARIES_DIR);
};

export const binaryStatus = (
  settings: MediaSettings,
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
): BinaryStatus => {
  if (settings.mode === 'false') return { ok: false, reason: 'conversão desligada (TRANSCODE_ENABLED=false)' };
  let ffmpeg = locate(settings.ffmpegPath, 'ffmpeg', which);
  let ffprobe = locate(settings.ffprobePath, 'ffprobe', which);
  if (!ffmpeg) {
    ffmpeg = settings.ffmpegPath;
    if (!isTrustedPath(ffmpeg)) return { ok: false, reason: 'FFmpeg path não confiável: deve estar em /usr/local/bin' };
    if (!existsSync(ffmpeg)) return { ok: false, reason: 'ffmpeg não encontrado' };
  }
  if (!ffprobe) {
    ffprobe = settings.ffprobePath;
    if (!isTrustedPath(ffprobe)) return { ok: false, reason: 'FFprobe path não confiável: deve estar em /usr/local/bin' };
    if (!existsSync(ffprobe)) return { ok: false, reason: 'ffprobe não encontrado' };
  }
  return { ok: true, bins: { ffmpeg, ffprobe } };
};
