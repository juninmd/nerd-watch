import type { ReactNode } from 'react';
import { openOverlay } from '../ui/overlay.tsx';

/**
 * Abre um diálogo na camada de overlays e devolve o foco a quem abriu. O `<dialog>` sai do DOM sem `close()`,
 * então o navegador não restaura o foco sozinho: sem isso ele cairia no `<body>`.
 */
export const openDialog = (render: (close: () => void) => ReactNode): (() => void) => {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  let closeOverlay: () => void = () => undefined;
  const close = (): void => {
    if (closed) return;
    closed = true;
    closeOverlay();
    if (opener?.isConnected) opener.focus();
  };
  closeOverlay = openOverlay(() => render(close));
  return close;
};
