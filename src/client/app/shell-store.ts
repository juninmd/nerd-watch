/**
 * Estado da casca (menu, gaveta, tema, status do Telegram) num store mínimo, sem DOM nem React: `main.ts` escreve,
 * `shell.tsx` lê com `useSyncExternalStore`. Testável direto (tests/client/shell-store.test.ts).
 */
import type { ThemePref } from './theme.ts';

export interface ShellAccount {
  name: string;
  avatarUrl: string | null;
}

export interface ShellState {
  activePath: string;
  drawerOpen: boolean;
  compact: boolean;
  theme: ThemePref;
  showLogout: boolean;
  /** `null` = ainda não sabemos (antes da primeira leitura ou se ela falhou). */
  connected: boolean | null;
  account: ShellAccount | null;
}

export interface ShellStore {
  get: () => ShellState;
  set: (patch: Partial<ShellState>) => void;
  subscribe: (fn: () => void) => () => void;
}

export const createShellStore = (initial: ShellState): ShellStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      const changed = (Object.keys(patch) as (keyof ShellState)[]).some((k) => patch[k] !== state[k]);
      if (!changed) return;
      state = { ...state, ...patch };
      for (const fn of listeners) fn();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
};

/** Rótulo do status do Telegram na barra superior (ex.: "Telegram · Ana"). */
export const connectionLabel = (connected: boolean | null, account: ShellAccount | null): string => {
  if (connected === null) return 'Telegram';
  if (!connected) return 'Telegram desconectado';
  return account ? `Telegram · ${account.name}` : 'Telegram conectado';
};
