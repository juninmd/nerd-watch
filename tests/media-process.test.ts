import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRemuxer } from '../src/server/media/remux.ts';
import { startLive } from '../src/server/media/live.ts';
import { createSlots, killAllProcesses, killProcess, liveProcessCount, readCapped, runCapped, spawnTracked } from '../src/server/media/process.ts';
import type { Subprocess } from 'bun';

/**
 * Processos de verdade (o próprio bun como filho), sem ffmpeg: cobre morte, zumbi, teto de saída, prazo e contrapressão.
 * O filho é o executável do próprio teste, então roda em qualquer máquina.
 */
const BUN = process.execPath;
const forever = `setInterval(() => {}, 1000)`;
const spawnForever = (): Subprocess<'ignore', 'pipe', 'pipe'> => spawnTracked(BUN, ['-e', forever]);

const exited = async (proc: Subprocess) => {
  await proc.exited;
  return proc.exitCode !== null || proc.signalCode !== null;
};

afterEach(() => {
  killAllProcesses();
});

describe('slots de concorrência', () => {
  test('o teto é respeitado e liberar é idempotente', () => {
    const slots = createSlots(2);
    const a = slots.acquire();
    const b = slots.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(slots.acquire()).toBeNull();
    expect(slots.active).toBe(2);
    a?.();
    a?.();
    expect(slots.active).toBe(1);
    expect(slots.acquire()).not.toBeNull();
  });
});

describe('processos: morte e zumbis', () => {
  test('killProcess encerra o filho e nenhum zumbi fica vivo', async () => {
    const proc = spawnForever();
    expect(liveProcessCount()).toBeGreaterThan(0);
    killProcess(proc);
    expect(await exited(proc)).toBe(true);
  });

  test('killAllProcesses derruba todos os filhos registrados (caminho do SIGTERM)', async () => {
    const procs = [spawnForever(), spawnForever()];
    killAllProcesses();
    for (const proc of procs) expect(await exited(proc)).toBe(true);
  });

  test('runCapped com prazo estourado mata o filho e volta rápido, sem ok', async () => {
    const started = Date.now();
    const run = await runCapped(BUN, ['-e', forever], { timeoutMs: 200, maxBytes: 1024 });
    expect(run.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('runCapped recusa saída acima do teto (devolve null, não trunca em silêncio)', async () => {
    const run = await runCapped(BUN, ['-e', "process.stdout.write('x'.repeat(100_000))"], { timeoutMs: 10_000, maxBytes: 1000 });
    expect(run.stdout).toBeNull();
    expect(run.ok).toBe(false);
  });

  test('runCapped com saída pequena e código zero devolve os bytes', async () => {
    const run = await runCapped(BUN, ['-e', "process.stdout.write('ok')"], { timeoutMs: 10_000, maxBytes: 1000 });
    expect(run.ok).toBe(true);
    expect(new TextDecoder().decode(run.stdout ?? new Uint8Array())).toBe('ok');
  });

  test('readCapped lê até o teto e cancela ao passar', async () => {
    const chunk = new Uint8Array(600);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.close();
      },
    });
    expect(await readCapped(stream, 1000)).toBeNull();
  });
});

describe('transmissão ao vivo: contrapressão, cancelamento e ociosidade', () => {
  /** Filho falso que escreve um pedaço e fica vivo, como um ffmpeg fazendo stream. */
  const writesThenWaits = () => spawnTracked(BUN, ['-e', `process.stdout.write('x'.repeat(4096)); ${forever}`]);
  const opts = { input: path.resolve('/media/ep.mkv'), startSeconds: 0, videoStreamIndex: 0, audioOrdinal: null, deinterlace: false };
  const bins = { ffmpeg: BUN, ffprobe: BUN };

  test('cancelar a resposta (aba fechada) mata o processo e libera o slot', async () => {
    const slots = createSlots(1);
    let proc: Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    const spawn = () => {
      proc = writesThenWaits();
      return proc;
    };
    const res = startLive({ bins, slots, idleMs: 60_000, spawn }, opts);
    if (!(res instanceof Response) || !res.body) throw new Error('esperava stream');
    const reader = res.body.getReader();
    await reader.read();
    expect(slots.active).toBe(1);
    await reader.cancel();
    expect(proc).toBeDefined();
    expect(await exited(proc as Subprocess)).toBe(true);
    expect(slots.active).toBe(0);
  });

  test('sem slot livre, devolve busy e não sobe processo', () => {
    const slots = createSlots(1);
    const first = startLive({ bins, slots, idleMs: 60_000, spawn: writesThenWaits }, opts);
    expect(first).toBeInstanceOf(Response);
    const second = startLive({ bins, slots, idleMs: 60_000, spawn: writesThenWaits }, opts);
    expect(second).toEqual({ busy: true });
    if (first instanceof Response) void first.body?.cancel();
  });

  test('cliente parado por mais que o prazo de ociosidade: o ffmpeg é morto e o slot volta', async () => {
    const slots = createSlots(1);
    let proc: Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
    const res = startLive(
      {
        bins,
        slots,
        idleMs: 150,
        spawn: () => {
          proc = spawnForever();
          return proc;
        },
      },
      opts,
    );
    if (!(res instanceof Response)) throw new Error('esperava stream');
    // Nenhum read: o cliente não pede dados. A ociosidade (150 ms) precisa matar o processo.
    await Bun.sleep(900);
    expect(proc).toBeDefined();
    expect(await exited(proc as Subprocess)).toBe(true);
    expect(slots.active).toBe(0);
  });
});

describe('remux: falha no start não prende slot', () => {
  test('binário inexistente vira erro do job e devolve o slot', async () => {
    const slots = createSlots(1);
    const dir = await mkdtemp(path.join(tmpdir(), 'nw-remux-'));
    const remuxer = createRemuxer({
      bins: { ffmpeg: path.resolve('/definitely/missing/ffmpeg'), ffprobe: BUN },
      slots,
      cacheDir: dir,
      cacheMaxBytes: 1024 * 1024,
      idleMs: 60_000,
    });
    const started = await remuxer.start({
      key: 'k1',
      input: path.resolve('/media/ep.mkv'),
      videoStreamIndex: 0,
      audioOrdinal: 0,
      audio: 'copy',
      durationSeconds: 10,
    });
    expect(started).toEqual({ state: 'running', progress: 0 });
    for (let i = 0; i < 50 && slots.active > 0; i++) await Bun.sleep(20);
    expect(slots.active).toBe(0);
    expect(await remuxer.status('k1')).toMatchObject({ state: 'error' });
    await rm(dir, { recursive: true, force: true });
  });
});
