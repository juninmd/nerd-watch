import { probeArgs } from './args.ts';
import { parseProbe, type ProbeInfo } from './probe-parse.ts';
import { runCapped } from './process.ts';

/** Tamanho máximo aceito do JSON do ffprobe: um arquivo normal tem poucos KB; passou disso é lixo ou ataque. */
const MAX_PROBE_BYTES = 2 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 20_000;
const CACHE_MAX_ENTRIES = 256;

/**
 * Sonda um arquivo com ffprobe (prazo e teto de saída). Resultado em memória por (caminho, tamanho, mtime): o mesmo
 * arquivo não é sondado de novo a cada pedido de reprodução. Falha vira `null`, nunca exceção.
 */
export const createProber = (ffprobe: string) => {
  const cache = new Map<string, ProbeInfo>();

  const remember = (key: string, value: ProbeInfo): void => {
    cache.set(key, value);
    if (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  return {
    async probe(file: string, fileKey: string): Promise<ProbeInfo | null> {
      const hit = cache.get(fileKey);
      if (hit) return hit;
      const run = await runCapped(ffprobe, probeArgs(file), { timeoutMs: PROBE_TIMEOUT_MS, maxBytes: MAX_PROBE_BYTES });
      if (!run.ok || !run.stdout) return null;
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(run.stdout));
      } catch {
        return null;
      }
      const info = parseProbe(json);
      remember(fileKey, info);
      return info;
    },
  };
};
