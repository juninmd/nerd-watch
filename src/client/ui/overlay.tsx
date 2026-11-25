/**
 * Camada de diálogos abertos de qualquer lugar (sorteio, episódio, pessoa…). `openOverlay` devolve `close`;
 * a casca desenha `<OverlayHost />` uma vez. O estado do diálogo mora no componente que `render` devolve.
 */
import { Fragment, type ReactNode, useSyncExternalStore } from 'react';

let entries: { id: number; node: ReactNode }[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = (): void => {
  for (const fn of listeners) fn();
};

export const openOverlay = (render: (close: () => void) => ReactNode): (() => void) => {
  const id = ++seq;
  const close = (): void => {
    entries = entries.filter((e) => e.id !== id);
    emit();
  };
  entries = [...entries, { id, node: render(close) }];
  emit();
  return close;
};

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function OverlayHost() {
  const list = useSyncExternalStore(subscribe, () => entries);
  return list.map((e) => <Fragment key={e.id}>{e.node}</Fragment>);
}
