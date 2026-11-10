import { ARROW_SEEK_SECONDS, SEEK_SECONDS, VOLUME_STEP } from './player-seek.ts';

/** O que uma tecla pede ao player. Pura: quem chama decide se a tecla vale no contexto atual. */
export type PlayerAction =
  | { kind: 'toggle' }
  | { kind: 'seekBy'; seconds: number }
  | { kind: 'seekPercent'; digit: number }
  | { kind: 'volumeBy'; delta: number }
  | { kind: 'mute' }
  | { kind: 'fullscreen' }
  | { kind: 'captions' }
  | { kind: 'speedBy'; dir: 1 | -1 }
  | { kind: 'next' };

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Mapeamento no padrão do YouTube. Ctrl/Cmd/Alt são ignorados (atalhos do navegador). Shift só vale para `<` e `>`,
 * que já exigem Shift no teclado. `g` não aparece aqui: é prefixo de navegação (shortcuts.ts).
 */
export const playerKeyAction = (input: KeyInput): PlayerAction | null => {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.key === '<') return { kind: 'speedBy', dir: -1 };
  if (input.key === '>') return { kind: 'speedBy', dir: 1 };
  if (input.shiftKey) return null;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (/^[0-9]$/.test(key)) return { kind: 'seekPercent', digit: Number(key) };
  switch (key) {
    case ' ':
    case 'k':
      return { kind: 'toggle' };
    case 'j':
      return { kind: 'seekBy', seconds: -SEEK_SECONDS };
    case 'l':
      return { kind: 'seekBy', seconds: SEEK_SECONDS };
    case 'ArrowLeft':
      return { kind: 'seekBy', seconds: -ARROW_SEEK_SECONDS };
    case 'ArrowRight':
      return { kind: 'seekBy', seconds: ARROW_SEEK_SECONDS };
    case 'ArrowUp':
      return { kind: 'volumeBy', delta: VOLUME_STEP };
    case 'ArrowDown':
      return { kind: 'volumeBy', delta: -VOLUME_STEP };
    case 'm':
      return { kind: 'mute' };
    case 'f':
      return { kind: 'fullscreen' };
    case 'c':
      return { kind: 'captions' };
    case 'n':
      return { kind: 'next' };
    default:
      return null;
  }
};

export type TargetKind = 'text' | 'control' | 'none';

const CONTROL_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color']);

/**
 * Classifica o alvo do evento: "text" recebe digitação (nenhuma tecla do player), "control" é algo que já reage a
 * Espaço/Enter (botão, link, checkbox), "none" é o próprio player ou um elemento neutro (vídeo, slider de posição).
 */
export const targetKind = (tagName: string, inputType: string | null, editable: boolean): TargetKind => {
  if (editable || tagName === 'TEXTAREA' || tagName === 'SELECT') return 'text';
  if (tagName === 'INPUT') {
    if (inputType === 'range') return 'none';
    return inputType !== null && CONTROL_INPUT_TYPES.has(inputType) ? 'control' : 'text';
  }
  if (tagName === 'BUTTON' || tagName === 'A') return 'control';
  return 'none';
};

/** Espaço e Enter continuam ativando o controle focado; as demais teclas do player valem mesmo com foco num botão. */
export const keyAllowed = (kind: TargetKind, key: string): boolean => {
  if (kind === 'text') return false;
  if (kind === 'control') return key !== ' ' && key !== 'Enter';
  return true;
};
