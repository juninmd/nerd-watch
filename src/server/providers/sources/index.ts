import { registerDrive } from '../drive/source.ts';
import { registerDropbox } from '../dropbox/source.ts';
import { registerOneDrive } from '../onedrive/source.ts';
import { registerTrakt } from '../trakt/descriptor.ts';
import { registerLocal } from '../local/source.ts';
import { registerS3 } from '../s3/source.ts';
import { registerWebdav } from '../webdav/source.ts';
import { registerPeertube } from '../peertube/source.ts';
import { registerYoutube } from '../youtube/source.ts';
import { registerJellyfin } from '../jellyfin/source.ts';
import { registerPlex } from '../plex/source.ts';
import { registerTorrent } from '../torrent/source.ts';

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
  registerLocal();
  registerWebdav();
  registerS3();
  registerPeertube();
  registerYoutube();
  registerJellyfin();
  registerPlex();
  registerTorrent();
};
