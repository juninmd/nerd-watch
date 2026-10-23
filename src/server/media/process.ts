import type { Subprocess } from 'bun';

/**
 * Processos externos (ffmpeg/ffprobe) com as garantias de recurso: teto de concorrência, saída limitada, morte
 * garantida (SIGTERM e, se preciso, SIGKILL) e nenhum processo órfão ao desligar o servidor.
 */

export type Release = () => void;

/** Slots de concorrência: `acquire()` devolve a função de liberar, ou `null` quando todos estão ocupados (vira 503). */
export interface Slots {
  acquire(): Release | null;
  readonly active: number;
}

export const createSlots = (max: number): Slots => {
  let active = 0;
  return {
    acquire() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
    get active() {
      return active;
    },
  };
};

const live = new Set<Subprocess>();
const KILL_GRACE_MS = 3000;

/** Mata com SIGTERM e, sem sair em `KILL_GRACE_MS`, com SIGKILL. O timer não segura o event loop. */
export const killProcess = (proc: Subprocess): void => {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    return;
  }
  const force = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // já saiu entre a checagem e o kill
      }
    }
  }, KILL_GRACE_MS);
  force.unref();
};

/**
 * Sobe o processo sem shell (`cmd` e `args` separados) e o registra para o desligamento. O stderr é consumido com um
 * teto: nunca vai para log (pode carregar caminho), e um processo com stderr cheio não trava.
 */
export const spawnTracked = (cmd: string, args: string[]): Subprocess<'ignore', 'pipe', 'pipe'> => {
  const proc = Bun.spawn([cmd, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  live.add(proc);
  void proc.exited.then(() => live.delete(proc));
  void drainCapped(proc.stderr, 4096);
  return proc;
};

/** Lê e descarta até `max` bytes; depois só esvazia o stream para o processo não bloquear na escrita. */
const drainCapped = async (stream: ReadableStream<Uint8Array> | null, max: number): Promise<void> => {
  if (!stream) return;
  const reader = stream.getReader();
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
      if (seen > max) break;
    }
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // o processo morreu no meio da leitura: não há o que fazer com o restante
  }
};

/**
 * Lê o stream inteiro até `max` bytes. Passou do teto, cancela a leitura e devolve `null` (o chamador trata como erro).
 */
export const readCapped = async (stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

export interface CappedRun {
  ok: boolean;
  stdout: Uint8Array | null;
}

/**
 * Roda um comando curto (ffprobe, legenda) com prazo e teto de saída. Prazo estourado mata o processo e devolve
 * `ok: false`; a espera é sempre até o processo sair, então não sobra zumbi.
 */
export const runCapped = async (
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; maxBytes: number },
): Promise<CappedRun> => {
  const proc = spawnTracked(cmd, args);
  const timer = setTimeout(() => killProcess(proc), opts.timeoutMs);
  try {
    const stdout = await readCapped(proc.stdout, opts.maxBytes);
    if (stdout === null) {
      killProcess(proc);
      await proc.exited;
      return { ok: false, stdout: null };
    }
    const code = await proc.exited;
    return { ok: code === 0, stdout };
  } catch {
    killProcess(proc);
    await proc.exited;
    return { ok: false, stdout: null };
  } finally {
    clearTimeout(timer);
  }
};

/** Mata tudo que está rodando. Chamado no SIGTERM/SIGINT para não deixar ffmpeg órfão. */
export const killAllProcesses = (): void => {
  for (const proc of live) killProcess(proc);
};

export const liveProcessCount = (): number => live.size;

let shutdownInstalled = false;

/** Um handler só: mata os filhos e encerra. Sem isso um Ctrl+C deixaria o ffmpeg gravando sozinho. */
export const installShutdownHandlers = (): void => {
  if (shutdownInstalled) return;
  shutdownInstalled = true;
  const stop = (signal: NodeJS.Signals) => {
    killAllProcesses();
    setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 200).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
};
