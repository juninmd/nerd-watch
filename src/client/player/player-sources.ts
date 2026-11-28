import type { SourceOption } from '../addons/stream-switch.ts';

/**
 * Menu "Fonte" da barra do player: quem conhece as fontes (o painel de streams do episódio) publica a lista e
 * como trocar; a barra só desenha. Sem tela dona, `null` e o menu some.
 */
export interface SourceMenu {
  options: SourceOption[];
  select: (option: SourceOption) => void;
}

let menu: SourceMenu | null = null;
const listeners = new Set<() => void>();

export const setSourceMenu = (next: SourceMenu | null): void => {
  menu = next;
  for (const fn of listeners) fn();
};
export const getSourceMenu = (): SourceMenu | null => menu;
export const subscribeSourceMenu = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
