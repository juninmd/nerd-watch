import { MAX_ENTRIES, type ResumeMeta, type StoredPosition } from './playback-store.ts';

/** Posição como o servidor a devolve (`GET /api/playback`). */
export interface RemotePosition {
  key: string;
  seconds: number;
  duration: number | null;
  at: number;
  done: boolean;
  meta: ResumeMeta | null;
}

export type PendingOp = 'put' | 'delete';

/** Mudanças locais ainda não confirmadas pelo servidor. */
export interface SyncState {
  /** Falso até a primeira sincronização bem-sucedida (aí o que só existe localmente é migrado, não apagado). */
  initialized: boolean;
  pending: Record<string, PendingOp>;
}

export interface MergeResult {
  map: Record<string, StoredPosition>;
  pending: Record<string, PendingOp>;
  changed: boolean;
}

export const toStored = (r: RemotePosition): StoredPosition => {
  const p: StoredPosition = { seconds: r.seconds, duration: r.duration, at: r.at };
  if (r.meta) p.meta = r.meta;
  if (r.done) p.done = true;
  return p;
};

/**
 * Junta o cache local com o que o servidor tem. Regras:
 * - vence a gravação com `at` maior (o mesmo critério do servidor);
 * - o que o usuário apagou localmente não ressuscita a partir do servidor;
 * - chave que sumiu do servidor e não tem mudança pendente foi apagada em outro aparelho: sai daqui também;
 * - na primeira sincronização, o que só existe localmente é enviado (migração).
 * Função pura: não toca em storage nem em rede.
 */
export const mergeRemote = (local: Record<string, StoredPosition>, remote: RemotePosition[], state: SyncState, capacity = MAX_ENTRIES): MergeResult => {
  const map: Record<string, StoredPosition> = { ...local };
  const pending: Record<string, PendingOp> = { ...state.pending };
  const remoteKeys = new Set<string>();
  let changed = false;

  const hasRoomFor = (at: number): boolean => {
    const values = Object.values(map);
    if (values.length < capacity) return true;
    return at > Math.min(...values.map((p) => p.at));
  };

  for (const r of remote) {
    remoteKeys.add(r.key);
    if (pending[r.key] === 'delete') continue;
    const mine = local[r.key];
    if (!mine) {
      if (hasRoomFor(r.at)) {
        map[r.key] = toStored(r);
        changed = true;
      }
    } else if (r.at > mine.at) {
      map[r.key] = toStored(r);
      delete pending[r.key];
      changed = true;
    } else if (mine.at > r.at) {
      pending[r.key] = 'put';
    }
  }

  for (const key of Object.keys(local)) {
    if (remoteKeys.has(key) || pending[key]) continue;
    if (state.initialized) {
      delete map[key];
      changed = true;
    } else {
      pending[key] = 'put';
    }
  }

  return { map, pending, changed };
};
