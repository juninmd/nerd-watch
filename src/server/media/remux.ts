import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { cachePath, enforceCacheLimit, touchCache } from './cache.ts';
import { remuxArgs } from './args.ts';
import { killProcess, type Slots, spawnTracked } from './process.ts';
import type { Binaries } from './binaries.ts';

export type RemuxState = 'idle' | 'running' | 'ready' | 'error';

export interface RemuxStatus {
  state: RemuxState;
  /** 0 a 1. Sem duração conhecida fica em 0 até terminar. */
  progress: number;
  error?: string;
}

export interface RemuxRequest {
  key: string;
  input: string;
  videoStreamIndex: number;
  audioOrdinal: number | null;
  audio: 'copy' | 'aac' | 'none';
  durationSeconds: number | null;
}

export interface RemuxDeps {
  bins: Binaries;
  slots: Slots;
  cacheDir: string;
  cacheMaxBytes: number;
  idleMs: number;
}

interface Job {
  state: 'running' | 'done' | 'error';
  progress: number;
  error?: string;
  lastProgressAt: number;
}

/** Linha `chave=valor` do `-progress pipe:1`. Só `out_time_us` e `progress` importam aqui. */
export const parseProgressLine = (line: string): { key: string; value: string } | null => {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
};

/** Fração concluída a partir do tempo de saída em microssegundos. Sem duração conhecida fica em 0. */
export const progressFraction = (outTimeUs: number, durationSeconds: number | null): number => {
  if (!durationSeconds || durationSeconds <= 0 || !Number.isFinite(outTimeUs) || outTimeUs < 0) return 0;
  return Math.min(0.99, outTimeUs / 1_000_000 / durationSeconds);
};

/** Lê o stdout do ffmpeg linha a linha e entrega os pares chave/valor. Não guarda nada além da linha atual. */
const pumpProgress = async (
  stream: ReadableStream<Uint8Array>,
  onPair: (key: string, value: string) => void,
): Promise<void> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const pair = parseProgressLine(buffer.slice(0, nl));
      if (pair) onPair(pair.key, pair.value);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
    if (buffer.length > 4096) buffer = '';
  }
};

const fileExists = async (file: string): Promise<boolean> => {
  const info = await stat(file).catch(() => null);
  return info?.isFile() === true;
};

/**
 * Conversões de remux em segundo plano, com dedupe: dois pedidos do mesmo arquivo compartilham um único processo.
 * Cada job ocupa um slot; sem slot livre o pedido volta `busy` (a rota responde 503 com Retry-After).
 */
export const createRemuxer = (deps: RemuxDeps, now: () => number = Date.now) => {
  const jobs = new Map<string, Job>();

  const finish = async (
    key: string,
    job: Job,
    part: string,
    final: string,
    code: number | null,
    release: () => void,
  ) => {
    release();
    if (code === 0 && (await fileExists(part))) {
      await rename(part, final);
      await enforceCacheLimit(deps.cacheDir, deps.cacheMaxBytes, new Set([`${key}.mp4`]));
      job.state = 'done';
      jobs.delete(key);
      return;
    }
    await rm(part, { force: true });
    job.state = 'error';
    job.error = job.error ?? 'não foi possível converter este arquivo';
  };

  const run = (req: RemuxRequest, job: Job, release: () => void): void => {
    const final = cachePath(deps.cacheDir, req.key);
    const part = `${final}.part`;
    void (async () => {
      // Qualquer falha (spawn, I/O, rename) vira erro do job, nunca um "running" eterno com o slot preso.
      let watchdog: ReturnType<typeof setInterval> | undefined;
      try {
        await mkdir(deps.cacheDir, { recursive: true });
        await rm(part, { force: true });
        const proc = spawnTracked(
          deps.bins.ffmpeg,
          remuxArgs({
            input: req.input,
            output: part,
            videoStreamIndex: req.videoStreamIndex,
            audioOrdinal: req.audioOrdinal,
            audio: req.audio,
          }),
        );
        watchdog = setInterval(
          () => {
            if (now() - job.lastProgressAt <= deps.idleMs) return;
            job.error = 'a conversão parou de avançar';
            killProcess(proc);
          },
          Math.min(deps.idleMs, 5000),
        );
        await pumpProgress(proc.stdout, (key, value) => {
          if (key === 'out_time_us') {
            job.progress = progressFraction(Number(value), req.durationSeconds);
            job.lastProgressAt = now();
          }
        });
        const code = await proc.exited;
        if (code === 0) job.progress = 1;
        await finish(req.key, job, part, final, code, release);
      } catch {
        await rm(part, { force: true });
        job.state = 'error';
        job.error = job.error ?? 'não foi possível converter este arquivo';
      } finally {
        if (watchdog) clearInterval(watchdog);
        release();
      }
    })();
  };

  return {
    /** Começa (ou reaproveita) a conversão. Devolve o estado atual; `busy` quando não há slot. */
    async start(req: RemuxRequest): Promise<RemuxStatus | { busy: true }> {
      const existing = jobs.get(req.key);
      if (existing?.state === 'running') return { state: 'running', progress: existing.progress };
      if (existing?.state === 'error') jobs.delete(req.key);
      // Reserva o job antes de qualquer await: dois pedidos simultâneos não podem passar pelo mesmo teste e rodar dois ffmpeg.
      const release = deps.slots.acquire();
      if (!release) return { busy: true };
      const job: Job = { state: 'running', progress: 0, lastProgressAt: now() };
      jobs.set(req.key, job);
      const file = cachePath(deps.cacheDir, req.key);
      if (await fileExists(file)) {
        jobs.delete(req.key);
        release();
        await touchCache(file);
        return { state: 'ready', progress: 1 };
      }
      run(req, job, release);
      return { state: 'running', progress: 0 };
    },

    async status(key: string): Promise<RemuxStatus> {
      const job = jobs.get(key);
      if (job) return { state: job.state === 'done' ? 'ready' : job.state, progress: job.progress, error: job.error };
      const file = cachePath(deps.cacheDir, key);
      return (await fileExists(file)) ? { state: 'ready', progress: 1 } : { state: 'idle', progress: 0 };
    },
  };
};
