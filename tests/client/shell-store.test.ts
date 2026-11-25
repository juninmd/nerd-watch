import { describe, expect, test } from 'bun:test';
import { connectionLabel, createShellStore, type ShellState } from '../../src/client/app/shell-store.ts';

const initial: ShellState = {
  activePath: '/',
  drawerOpen: false,
  compact: false,
  theme: 'dark',
  showLogout: false,
  connected: null,
  account: null,
};

describe('createShellStore', () => {
  test('avisa quem assina quando o estado muda', () => {
    const store = createShellStore(initial);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ activePath: '/library' });
    expect(store.get().activePath).toBe('/library');
    expect(calls).toBe(1);
  });

  // Sem isso cada troca de rota redesenharia a casca inteira mesmo com o menu igual.
  test('não avisa nem troca a referência quando nada mudou', () => {
    const store = createShellStore(initial);
    const before = store.get();
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ activePath: '/', drawerOpen: false });
    expect(calls).toBe(0);
    expect(store.get()).toBe(before);
  });

  test('cancelar a assinatura para de avisar', () => {
    const store = createShellStore(initial);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    off();
    store.set({ compact: true });
    expect(calls).toBe(0);
  });
});

describe('connectionLabel', () => {
  test('cobre desconhecido, desconectado e conectado com e sem conta', () => {
    expect(connectionLabel(null, null)).toBe('Telegram');
    expect(connectionLabel(false, { name: 'Ana', avatarUrl: null })).toBe('Telegram desconectado');
    expect(connectionLabel(true, null)).toBe('Telegram conectado');
    expect(connectionLabel(true, { name: 'Ana', avatarUrl: null })).toBe('Telegram · Ana');
  });
});
