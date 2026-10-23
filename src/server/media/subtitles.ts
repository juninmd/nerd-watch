import { subtitleArgs } from './args.ts';
import { runCapped } from './process.ts';

/** Legenda de filme inteiro cabe folgada em 2 MB de texto; mais que isso não é legenda. */
const MAX_VTT_BYTES = 2 * 1024 * 1024;
const SUBTITLE_TIMEOUT_MS = 30_000;

/**
 * Extrai uma trilha de texto para WebVTT. Só expõe a API (o app não queima legenda no vídeo). Retorna `null` quando a
 * extração falha ou passa do teto.
 */
export const extractWebVtt = async (ffmpeg: string, input: string, ordinal: number): Promise<Uint8Array | null> => {
  const run = await runCapped(ffmpeg, subtitleArgs(input, ordinal), {
    timeoutMs: SUBTITLE_TIMEOUT_MS,
    maxBytes: MAX_VTT_BYTES,
  });
  return run.ok && run.stdout ? run.stdout : null;
};
