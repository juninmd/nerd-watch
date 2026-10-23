import path from 'node:path';

export type TranscodeMode = 'auto' | 'true' | 'false';

export interface MediaSettings {
  /** `false` desliga tudo; `auto` usa o ffmpeg se achar; `true` é o mesmo que `auto` (a diferença é só o aviso de boot). */
  mode: TranscodeMode;
  maxJobs: number;
  cacheDir: string;
  cacheMaxBytes: number;
  idleMs: number;
  ffmpegPath: string | undefined;
  ffprobePath: string | undefined;
  /** Idiomas de áudio na ordem de preferência (ISO 639-2 ou -1, minúsculo). */
  audioLangs: string[];
}

type Env = Record<string, string | undefined>;

const MB = 1024 * 1024;

/** Inteiro dentro de [min, max]; lixo ou fora da faixa volta ao padrão (nunca NaN nem zero que desligue um teto). */
const intEnv = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const modeEnv = (raw: string | undefined): TranscodeMode => {
  const value = raw?.trim().toLowerCase();
  return value === 'true' || value === 'false' ? value : 'auto';
};

const pathEnv = (raw: string | undefined): string | undefined => raw?.trim() || undefined;

/**
 * Configuração de conversão a partir do ambiente. Tudo tem padrão seguro: sem ffmpeg instalado o app se comporta
 * como antes, e a fila/cache têm teto mesmo que a variável seja ignorada.
 */
export const mediaSettings = (env: Env = process.env, cwd: string = process.cwd()): MediaSettings => ({
  mode: modeEnv(env.TRANSCODE_ENABLED),
  maxJobs: intEnv(env.TRANSCODE_MAX_JOBS, 1, 1, 8),
  cacheDir: path.resolve(cwd, pathEnv(env.TRANSCODE_CACHE_DIR) ?? 'data/media-cache'),
  cacheMaxBytes: intEnv(env.TRANSCODE_CACHE_MAX_MB, 4096, 256, 1_000_000) * MB,
  idleMs: intEnv(env.TRANSCODE_IDLE_SECONDS, 60, 5, 3600) * 1000,
  ffmpegPath: pathEnv(env.FFMPEG_PATH),
  ffprobePath: pathEnv(env.FFPROBE_PATH),
  audioLangs: (env.TRANSCODE_AUDIO_LANGS ?? 'por,pt,eng,en')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
});
