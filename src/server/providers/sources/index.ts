import { registerDrive } from '../drive/source.ts';
import { registerLocal } from '../local/source.ts';
import { registerS3 } from '../s3/source.ts';
import { registerWebdav } from '../webdav/source.ts';

/**
 * Um provider novo = um módulo com `registerX()` (descriptor + FileSource) e uma linha aqui.
 * Chamado uma vez no boot (`index.ts`) e nos testes que precisam das fontes registradas.
 */
let registered = false;

export const registerAllSources = (): void => {
  if (registered) return;
  registered = true;
  registerDrive();
  registerLocal();
  registerWebdav();
  registerS3();
};
