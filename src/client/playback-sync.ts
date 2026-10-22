import { isPermanentError, type PlaybackApi } from './playback-api.ts';
import { type PendingOp, type RemotePosition, type SyncState, mergeRemote } from './playback-merge.ts';
import { createPlaybackStore, type StorageLike, type StoredPosition } from './playback-store.ts';

/** Disparado quando a sincronização traz novidades: quem mostra "continuar" re-renderiza. */
export const PLAYBACK_CHANGED_EVENT = 'nw:playback-changed';

const STATE_KEY = 'nw.playback.sync';
/** Uma gravação por chave no máximo a cada ~12 s; o pause/fim/saída da página força o envio. */
export const PUSH_DEBOUNCE_MS = 12_000;
/** Falha de rede: tenta de novo depois, sem martelar o servidor. */
export const RETRY_MS = 60_000;
const PAGE = 500;
/** Mesmo teto do servidor: 10 páginas de 500 cobrem tudo que ele guarda. */
const MAX_PAGES = 10;

export interface PlaybackSyncOptions {
  storage: StorageLike;
  api: PlaybackApi;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onRemoteChange?: () => void;
}

const loadState = (storage: StorageLike): SyncState => {
  try {
    const parsed = JSON.parse(storage.getItem(STATE_KEY) ?? 'null') as Partial<SyncState> | null;
    const pending: Record<string, PendingOp> = {};
    for (const [key, op] of Object.entries(parsed?.pending ?? {})) if (op === 'put' || op === 'delete') pending[key] = op;
    return { initialized: parsed?.initialized === true, pending };
  } catch {
    return { initialized: false, pending: {} };
  }
};

/**
 * Sincronização local-first: a leitura continua síncrona no cache do navegador; aqui só se envia o que mudou
 * e se traz o que outro aparelho gravou. Tudo passa por uma fila em série, então um envio nunca corre por
 * cima de um GET (e o merge não confunde "ainda não chegou" com "foi apagado").
 */
export const createPlaybackSync = (opts: PlaybackSyncOptions) => {
  const { storage, api, onRemoteChange } = opts;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const state = loadState(storage);
  let timer: unknown;
  let chain: Promise<unknown> = Promise.resolve();

  const persist = (): void => {
    try {
      storage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // armazenamento cheio/bloqueado: a fila fica só em memória até a próxima gravação
    }
  };

  const arm = (ms: number): void => {
    if (timer !== undefined) return;
    timer = setTimer(() => {
      timer = undefined;
      void flush();
    }, ms);
  };

  const disarm = (): void => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const store = createPlaybackStore(storage, opts.now ?? Date.now, (key, op) => {
    state.pending[key] = op;
    persist();
    arm(PUSH_DEBOUNCE_MS);
  });

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task);
    chain = run.catch(() => undefined);
    return run;
  };

  /** Só limpa a pendência se nada mudou durante o envio; senão a versão nova continua na fila. */
  const settle = (key: string, op: PendingOp, sent: StoredPosition | undefined): void => {
    if (state.pending[key] !== op) return;
    if (op === 'put' && store.get(key)?.at !== sent?.at) return;
    delete state.pending[key];
  };

  /** Envia a fila. Devolve false se parou numa falha de rede (já agendou nova tentativa). */
  const pushPending = async (): Promise<boolean> => {
    for (const [key, op] of Object.entries(state.pending)) {
      const sent = op === 'put' ? store.get(key) : undefined;
      if (op === 'put' && !sent) {
        delete state.pending[key];
        continue;
      }
      try {
        if (sent) await api.put(key, sent);
        else await api.remove(key);
      } catch (err) {
        if (!isPermanentError(err)) {
          persist();
          arm(RETRY_MS);
          return false;
        }
        // o servidor recusou este registro: descarta a pendência para não travar a fila para sempre
      }
      settle(key, op, sent);
      persist();
    }
    persist();
    return true;
  };

  const flush = (): Promise<void> =>
    serial(async () => {
      disarm();
      await pushPending();
    });

  const listAll = async (): Promise<RemotePosition[]> => {
    const rows: RemotePosition[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await api.list(page * PAGE, PAGE);
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    return rows;
  };

  /** Envia o pendente, traz o servidor e funde. Na primeira vez também sobe o que já existia localmente. */
  const pull = (): Promise<void> =>
    serial(async () => {
      if (!(await pushPending())) return;
      let remote: RemotePosition[];
      try {
        remote = await listAll();
      } catch {
        arm(RETRY_MS);
        return;
      }
      // Tudo abaixo é síncrono, então o que o usuário gravou durante o GET entra no merge como pendência.
      const result = mergeRemote(store.entries(), remote, state);
      state.pending = result.pending;
      state.initialized = true;
      if (result.changed) store.replaceAll(result.map);
      persist();
      if (result.changed) onRemoteChange?.();
      await pushPending();
    });

  /** Saída da página: envio com `keepalive`, sem fila (o navegador pode fechar antes da resposta). */
  const flushKeepalive = (): void => {
    persist();
    for (const [key, op] of Object.entries(state.pending)) {
      const sent = op === 'put' ? store.get(key) : undefined;
      if (op === 'put' && !sent) continue;
      const request = sent ? api.put(key, sent, { keepalive: true }) : api.remove(key, { keepalive: true });
      request.then(
        () => {
          settle(key, op, sent);
          persist();
        },
        (err: unknown) => {
          if (!isPermanentError(err)) return;
          settle(key, op, sent);
          persist();
        },
      );
    }
  };

  return { store, pull, flush, flushKeepalive };
};
