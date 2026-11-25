import { createElement } from 'react';
import { openDialog } from './open-dialog.ts';
import { PaletteDialog } from './palette-dialog.tsx';

export { invalidatePaletteData } from './palette-data.ts';

let isOpen = false;

/** Abre a paleta (Ctrl K, `/` ou o botão da barra). Uma aberta por vez. */
export const openCommandPalette = (): void => {
  if (isOpen) return;
  isOpen = true;
  openDialog((close) =>
    createElement(PaletteDialog, {
      onClose: () => {
        isOpen = false;
        close();
      },
    }),
  );
};
