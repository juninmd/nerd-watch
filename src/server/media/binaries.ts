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
  const ffmpeg = resolveBin('ffmpeg', settings.ffmpegPath, which);
  if (!ffmpeg.ok) return ffmpeg;
  const ffprobe = resolveBin('ffprobe', settings.ffprobePath, which);
  if (!ffprobe.ok) return ffprobe;
  return { ok: true, bins: { ffmpeg: ffmpeg.path, ffprobe: ffprobe.path } };
};

type ResolvedBin = { ok: true; path: string } | { ok: false; reason: string };

/** Sem caminho explícito e fora do PATH, a razão ainda diz como ativar; nunca lança com caminho ausente. */
const resolveBin = (
  name: string,
  explicit: string | undefined,
  which: (bin: string) => string | null,
): ResolvedBin => {
  const found = locate(explicit, name, which);
  if (found) return { ok: true, path: found };
  if (!explicit) return { ok: false, reason: `${name} não encontrado: ${HOW_TO_ENABLE}` };
  if (!isTrustedPath(explicit)) {
    return { ok: false, reason: `${name} path não confiável: deve estar em /usr/local/bin; ${HOW_TO_ENABLE}` };
  }
  return { ok: false, reason: `${name} não encontrado em ${explicit}: ${HOW_TO_ENABLE}` };
};
