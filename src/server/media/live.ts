import type { Subprocess } from 'bun';
import type { Binaries } from './binaries.ts';
import { liveArgs, type LiveOptions } from './args.ts';
import { killProcess, type Slots, spawnTracked } from './process.ts';

export interface LiveDeps {
  bins: Binaries;
  slots: Slots;
  /** Sem leitura do cliente por esse tempo (aba pausada, rede sumiu), o ffmpeg é morto e o slot liberado. */
  idleMs: number;
  spawn?: (cmd: string, args: string[]) => Subprocess<'ignore', 'pipe', 'pipe'>;
}

/**
 * Stream de transcodificação ao vivo. A contrapressão é natural: o ffmpeg escreve no pipe do stdout e só avança
 * quando o navegador pede o próximo pedaço (`pull`). Cancelar a resposta (fechar a aba) mata o processo.
 * Devolve `busy` quando não há slot livre.
 */
export const startLive = (deps: LiveDeps, opts: LiveOptions): Response | { busy: true } => {
  const release = deps.slots.acquire();
  if (!release) return { busy: true };

  let proc: Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = (deps.spawn ?? spawnTracked)(deps.bins.ffmpeg, liveArgs(opts));
  } catch (err) {
    // Binário sumiu ou sem permissão: o slot volta, senão o teto de jobs fica preso até reiniciar.
    release();
    throw err;
  }
  const reader = proc.stdout.getReader();
  let lastPull = Date.now();
  let finished = false;

  const end = (): void => {
    if (finished) return;
    finished = true;
    clearInterval(watchdog);
    release();
    killProcess(proc);
  };

  const watchdog = setInterval(
    () => {
      if (Date.now() - lastPull > deps.idleMs) end();
    },
    Math.min(deps.idleMs, 5000),
  );
  void proc.exited.then(end);

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        lastPull = Date.now();
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            end();
            return;
          }
          controller.enqueue(value);
        } catch {
          controller.close();
          end();
        }
      },
      cancel() {
        end();
        void reader.cancel().catch(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none', 'Cache-Control': 'no-store' },
  });
};
