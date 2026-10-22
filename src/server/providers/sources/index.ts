import { registerDrive } from '../drive/source.ts';
import { registerDropbox } from '../dropbox/source.ts';
import { registerOneDrive } from '../onedrive/source.ts';
import { registerTrakt } from '../trakt/descriptor.ts';

/**
 * Um provider novo = um módulo com `registerX()` (descriptor + FileSource) e uma linha aqui.
 * Chamado uma vez no boot (`index.ts`) e nos testes que precisam das fontes registradas.
 */
let registered = false;

export const registerAllSources = (): void => {
  if (registered) return;
  registered = true;
  registerDrive();
  registerDropbox();
  registerOneDrive();
  registerTrakt();
};
