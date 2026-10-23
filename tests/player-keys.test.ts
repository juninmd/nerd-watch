import { describe, expect, test } from 'bun:test';
import { keyAllowed, playerKeyAction, targetKind } from '../src/client/player-keys.ts';

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('playerKeyAction (padrão YouTube)', () => {
  test('espaço e k reproduzem/pausam', () => {
    expect(playerKeyAction(press(' '))).toEqual({ kind: 'toggle' });
    expect(playerKeyAction(press('k'))).toEqual({ kind: 'toggle' });
    expect(playerKeyAction(press('K'))).toEqual({ kind: 'toggle' });
  });

  test('j e l pulam 10 s; setas pulam 5 s', () => {
    expect(playerKeyAction(press('j'))).toEqual({ kind: 'seekBy', seconds: -10 });
    expect(playerKeyAction(press('l'))).toEqual({ kind: 'seekBy', seconds: 10 });
    expect(playerKeyAction(press('ArrowLeft'))).toEqual({ kind: 'seekBy', seconds: -5 });
    expect(playerKeyAction(press('ArrowRight'))).toEqual({ kind: 'seekBy', seconds: 5 });
  });

  test('setas para cima e para baixo mexem no volume', () => {
    expect(playerKeyAction(press('ArrowUp'))).toEqual({ kind: 'volumeBy', delta: 0.05 });
    expect(playerKeyAction(press('ArrowDown'))).toEqual({ kind: 'volumeBy', delta: -0.05 });
  });

  test('0 a 9 vão para 0% a 90%', () => {
    expect(playerKeyAction(press('0'))).toEqual({ kind: 'seekPercent', digit: 0 });
    expect(playerKeyAction(press('9'))).toEqual({ kind: 'seekPercent', digit: 9 });
  });

  test('m, f, c, n, < e > têm ação própria', () => {
    expect(playerKeyAction(press('m'))).toEqual({ kind: 'mute' });
    expect(playerKeyAction(press('f'))).toEqual({ kind: 'fullscreen' });
    expect(playerKeyAction(press('c'))).toEqual({ kind: 'captions' });
    expect(playerKeyAction(press('n'))).toEqual({ kind: 'next' });
    expect(playerKeyAction(press('<', { shiftKey: true }))).toEqual({ kind: 'speedBy', dir: -1 });
    expect(playerKeyAction(press('>', { shiftKey: true }))).toEqual({ kind: 'speedBy', dir: 1 });
  });

  test('teclas de outros usos devolvem null (não atrapalham a página)', () => {
    expect(playerKeyAction(press('a'))).toBeNull();
    expect(playerKeyAction(press('Enter'))).toBeNull();
    expect(playerKeyAction(press('?', { shiftKey: true }))).toBeNull();
  });

  test('Ctrl, Cmd e Alt são ignorados (Ctrl+K, Ctrl+L, Alt+setas do navegador)', () => {
    expect(playerKeyAction(press('k', { ctrlKey: true }))).toBeNull();
    expect(playerKeyAction(press('l', { metaKey: true }))).toBeNull();
    expect(playerKeyAction(press('ArrowLeft', { altKey: true }))).toBeNull();
  });

  test('Shift em letras e setas é ignorado (Shift+letra digita maiúscula em outro lugar)', () => {
    expect(playerKeyAction(press('L', { shiftKey: true }))).toBeNull();
    expect(playerKeyAction(press('ArrowRight', { shiftKey: true }))).toBeNull();
  });
});

describe('targetKind e keyAllowed (não roubar digitação)', () => {
  test('campos de texto, select e textarea são "text": nenhuma tecla do player entra', () => {
    expect(targetKind('INPUT', 'text', false)).toBe('text');
    expect(targetKind('TEXTAREA', null, false)).toBe('text');
    expect(targetKind('SELECT', null, false)).toBe('text');
    expect(targetKind('DIV', null, true)).toBe('text');
    expect(keyAllowed('text', 'k')).toBe(false);
    expect(keyAllowed('text', 'ArrowLeft')).toBe(false);
  });

  test('botões, links e checkboxes são "control": espaço e Enter continuam nativos', () => {
    expect(targetKind('BUTTON', null, false)).toBe('control');
    expect(targetKind('A', null, false)).toBe('control');
    expect(targetKind('INPUT', 'checkbox', false)).toBe('control');
    expect(keyAllowed('control', ' ')).toBe(false);
    expect(keyAllowed('control', 'Enter')).toBe(false);
    expect(keyAllowed('control', 'k')).toBe(true);
    expect(keyAllowed('control', 'ArrowUp')).toBe(true);
  });

  test('slider de posição (range) e vídeo não bloqueiam as teclas do player', () => {
    expect(targetKind('INPUT', 'range', false)).toBe('none');
    expect(targetKind('VIDEO', null, false)).toBe('none');
    expect(keyAllowed('none', 'ArrowLeft')).toBe(true);
  });
});
