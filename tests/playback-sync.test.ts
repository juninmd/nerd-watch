import { describe, expect, test } from 'bun:test';
import { PlaybackApiError, type PlaybackApi, isPermanentError } from '../src/client/playback-api.ts';
import { type RemotePosition, mergeRemote } from '../src/client/playback-merge.ts';
import { PUSH_DEBOUNCE_MS, RETRY_MS, createPlaybackSync } from '../src/client/playback-sync.ts';
import type { StoredPosition } from '../src/client/playback-store.ts';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map<string, string>(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

const remote = (key: string, at: number, seconds = 100): RemotePosition => ({ key, seconds, duration: 1400, at, done: false, meta: null });
const local = (at: number, seconds = 100): StoredPosition => ({ seconds, duration: 1400, at });
const pristine = { initialized: true, pending: {} };

describe('mergeRemote (função pura)', () => {
  test('o que o servidor tem mais novo vence; o local mais novo fica e vai para a fila de envio', () => {
    const merged = mergeRemote({ a: local(100, 10), b: local(300, 30) }, [remote('a', 200, 20), remote('b', 100, 99)], pristine);
    expect(merged.map.a).toEqual({ seconds: 20, duration: 1400, at: 200 });
    expect(merged.map.b?.seconds).toBe(30);
    expect(merged.pending).toEqual({ b: 'put' });
    expect(merged.changed).toBe(true);
  });

  test('primeira sincronização: o que só existe localmente é migrado (enviado), nada é apagado', () => {
    const merged = mergeRemote({ x: local(100) }, [], { initialized: false, pending: {} });
    expect(merged.map.x).toBeDefined();
    expect(merged.pending).toEqual({ x: 'put' });
    expect(merged.changed).toBe(false);
  });

  test('depois de sincronizada, chave que sumiu do servidor foi apagada em outro aparelho e sai daqui', () => {
    const merged = mergeRemote({ x: local(100) }, [], pristine);
    expect(merged.map.x).toBeUndefined();
    expect(merged.changed).toBe(true);
  });

  test('remoção feita aqui não ressuscita a partir da cópia do servidor', () => {
    const merged = mergeRemote({}, [remote('x', 100)], { initialized: true, pending: { x: 'delete' } });
    expect(merged.map.x).toBeUndefined();
    expect(merged.pending).toEqual({ x: 'delete' });
  });

  test('servidor mais novo cancela uma pendência de envio mais velha', () => {
    const merged = mergeRemote({ a: local(100) }, [remote('a', 300, 250)], { initialized: true, pending: { a: 'put' } });
    expect(merged.map.a?.seconds).toBe(250);
    expect(merged.pending).toEqual({});
  });

  test('cache cheio não adota posição mais antiga que todas as que já tem (mas adota a mais nova)', () => {
    const state = { initialized: true, pending: {} };
    const local2 = { a: local(500), b: local(400) };
    expect(mergeRemote(local2, [remote('c', 100)], state, 2).map.c).toBeUndefined();
    expect(mergeRemote(local2, [remote('d', 600)], state, 2).map.d).toBeDefined();
  });
});

describe('isPermanentError', () => {
  test.each([
    [400, true],
    [413, true],
    [429, false],
    [503, false],
  ])('status %i permanente? %p', (status, permanent) => {
    expect(isPermanentError(new PlaybackApiError(status))).toBe(permanent);
  });
  test('falha de rede (TypeError) é transitória', () => {
    expect(isPermanentError(new TypeError('fetch failed'))).toBe(false);
  });
});

/** Timers falsos: o teste dispara o debounce quando quiser. */
const fakeTimers = () => {
  let id = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const h = ++id;
      timers.set(h, { fn, ms });
      return h;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    armed: () => [...timers.values()].map((t) => t.ms),
    fire: () => {
      const due = [...timers.values()];
      timers.clear();
      for (const t of due) t.fn();
    },
  };
};

const fakeServer = () => {
  const rows = new Map<string, RemotePosition>();
  const calls: string[] = [];
  const keepalive: boolean[] = [];
  let failWith: unknown = null;
  let beforePut: (() => void) | null = null;
  const api: PlaybackApi = {
    async list(offset, limit) {
      calls.push('GET');
      if (failWith) throw failWith;
      return [...rows.values()].sort((a, b) => b.at - a.at).slice(offset, offset + limit);
    },
    async put(key, p, opts) {
      calls.push(`PUT ${key}`);
      keepalive.push(opts?.keepalive === true);
      if (failWith) throw failWith;
      beforePut?.();
      rows.set(key, { key, seconds: p.seconds, duration: p.duration, at: p.at, done: p.done === true, meta: p.meta ?? null });
    },
    async remove(key, opts) {
      calls.push(`DELETE ${key}`);
      keepalive.push(opts?.keepalive === true);
      if (failWith) throw failWith;
      rows.delete(key);
    },
  };
  return {
    api,
    rows,
    calls,
    keepalive,
    failWith: (e: unknown) => {
      failWith = e;
    },
    beforePut: (fn: () => void) => {
      beforePut = fn;
    },
  };
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = (initial: Record<string, string> = {}) => {
  let t = 1_000;
  const storage = memoryStorage(initial);
  const timers = fakeTimers();
  const server = fakeServer();
  let changed = 0;
  const sync = createPlaybackSync({
    storage,
    api: server.api,
    now: () => ++t,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onRemoteChange: () => void changed++,
  });
  return { sync, storage, timers, server, changed: () => changed };
};

const meta = { title: 'Ep', subtitle: 'Canal', poster: null, channelId: 'c1', messageId: '5' };

describe('sincronização', () => {
  test('várias gravações seguidas viram um único PUT, com o valor mais recente, após o debounce', async () => {
    const { sync, timers, server } = setup();
    for (const s of [10, 20, 30, 40, 50]) sync.store.save('c1:5', s, 1400, meta);
    expect(timers.armed()).toEqual([PUSH_DEBOUNCE_MS]);
    await tick();
    expect(server.calls).toEqual([]);

    timers.fire();
    await tick();
    expect(server.calls).toEqual(['PUT c1:5']);
    expect(server.rows.get('c1:5')?.seconds).toBe(50);
  });

  test('pause/fim forçam o envio na hora, sem esperar o debounce', async () => {
    const { sync, server, timers } = setup();
    sync.store.save('c1:5', 300, 1400, meta);
    await sync.flush();
    expect(server.calls).toEqual(['PUT c1:5']);
    expect(timers.armed()).toEqual([]);
  });

  test('falha de rede mantém a pendência e agenda nova tentativa; a tentativa seguinte envia', async () => {
    const { sync, server, timers } = setup();
    server.failWith(new TypeError('fetch failed'));
    sync.store.save('c1:5', 300, 1400, meta);
    await sync.flush();
    expect(timers.armed()).toEqual([RETRY_MS]);

    server.failWith(null);
    timers.fire();
    await tick();
    expect(server.rows.get('c1:5')?.seconds).toBe(300);
  });

  test('o servidor recusar o registro (400) descarta a pendência, sem tentar de novo para sempre', async () => {
    const { sync, server, timers, storage } = setup();
    server.failWith(new PlaybackApiError(400));
    sync.store.save('c1:5', 300, 1400, meta);
    await sync.flush();
    expect(timers.armed()).toEqual([]);
    expect(storage.data.get('nw.playback.sync')).toContain('"pending":{}');
  });

  test('a fila sobrevive a recarregar a página: outra instância com o mesmo storage envia o que faltou', async () => {
    const first = setup();
    first.server.failWith(new TypeError('offline'));
    first.sync.store.save('c1:5', 300, 1400, meta);
    await first.sync.flush();

    const server = first.server;
    server.failWith(null);
    const reloaded = createPlaybackSync({ storage: first.storage, api: server.api });
    await reloaded.flush();
    expect(server.rows.get('c1:5')?.seconds).toBe(300);
  });

  test('primeira sincronização sobe o progresso que já existia neste navegador (migração)', async () => {
    const existing = { 'c1:5': { seconds: 500, duration: 1400, at: 900, meta } };
    const { sync, server } = setup({ 'nw.playback': JSON.stringify(existing) });
    await sync.pull();
    expect(server.rows.get('c1:5')?.seconds).toBe(500);
    expect(sync.store.get('c1:5')?.seconds).toBe(500);
  });

  test('pull traz o que outro aparelho gravou, avisa uma vez e não avisa de novo sem novidade', async () => {
    const { sync, server, changed } = setup();
    server.rows.set('c2:9', { key: 'c2:9', seconds: 700, duration: 1400, at: 5_000, done: false, meta });
    await sync.pull();
    expect(sync.store.get('c2:9')?.seconds).toBe(700);
    expect(changed()).toBe(1);

    await sync.pull();
    expect(changed()).toBe(1);
  });

  test('pull falha sem rede: não mexe no cache local e agenda nova tentativa', async () => {
    const { sync, server, timers, changed } = setup();
    sync.store.save('c1:5', 300, 1400, meta);
    server.failWith(new TypeError('offline'));
    await sync.pull();
    expect(sync.store.get('c1:5')?.seconds).toBe(300);
    expect(changed()).toBe(0);
    // a gravação já armou o debounce (12 s), que é mais cedo que o retry: qualquer timer basta
    expect(timers.armed()).toHaveLength(1);
  });

  test('limpar uma posição remove também no servidor', async () => {
    const { sync, server } = setup();
    sync.store.save('c1:5', 300, 1400, meta);
    await sync.flush();
    sync.store.clear('c1:5');
    await sync.flush();
    expect(server.calls.at(-1)).toBe('DELETE c1:5');
    expect(server.rows.has('c1:5')).toBe(false);
  });

  test('gravação feita enquanto o PUT está em voo não some da fila', async () => {
    const { sync, server, timers } = setup();
    sync.store.save('c1:5', 300, 1400, meta);
    server.beforePut(() => sync.store.save('c1:5', 420, 1400, meta));
    await sync.flush();
    expect(timers.armed()).toEqual([PUSH_DEBOUNCE_MS]);

    server.beforePut(() => undefined);
    timers.fire();
    await tick();
    expect(server.rows.get('c1:5')?.seconds).toBe(420);
  });

  test('pull envia antes de ler: uma gravação ainda não enviada não é confundida com "apagada no servidor"', async () => {
    const { sync, server } = setup();
    sync.store.save('c1:9', 60, 1400, meta);
    await sync.pull();
    expect(server.calls.slice(0, 2)).toEqual(['PUT c1:9', 'GET']);
    expect(sync.store.get('c1:9')?.seconds).toBe(60);
  });

  test('saída da página usa keepalive e não espera resposta', async () => {
    const { sync, server } = setup();
    sync.store.save('c1:5', 300, 1400, meta);
    sync.flushKeepalive();
    expect(server.keepalive).toEqual([true]);
    await tick();
    expect(server.rows.get('c1:5')?.seconds).toBe(300);
  });
});
