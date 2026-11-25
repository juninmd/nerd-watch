import type { ReactNode } from 'react';
import { openOverlay } from '../ui/overlay.tsx';

/** `openOverlay` que devolve o foco a quem abriu: o diálogo sai do DOM ao fechar e o navegador não restaura sozinho. */
export const openDialog = (render: (close: () => void) => ReactNode): void => {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  openOverlay((close) =>
    render(() => {
      close();
      if (opener?.isConnected) opener.focus();
    }),
  );
};
