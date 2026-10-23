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
export const binaryStatus = (
  settings: MediaSettings,
  which: (bin: string) => string | null = (bin) => Bun.which(bin),
): BinaryStatus => {
  if (settings.mode === 'false') return { ok: false, reason: 'conversão desligada (TRANSCODE_ENABLED=false)' };
  const ffmpeg = locate(settings.ffmpegPath, 'ffmpeg', which);
  const ffprobe = locate(settings.ffprobePath, 'ffprobe', which);
  if (!ffmpeg || !ffprobe) return { ok: false, reason: `ffmpeg não encontrado: ${HOW_TO_ENABLE}` };
  return { ok: true, bins: { ffmpeg, ffprobe } };
};
