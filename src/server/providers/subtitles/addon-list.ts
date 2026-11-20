import { config } from '../../config/config.ts';
import { getDb } from '../../db/database.ts';
import { listEnabledAddons } from '../../repo/stremio-addons.ts';

/**
 * Addons de legenda: os do ambiente (`SUBTITLE_ADDONS`) mais os instalados pelo usuário na tela de addons
 * que declaram `subtitles`. Banco indisponível não derruba a busca: cai só nos do ambiente.
 */
export const subtitleAddonBases = async (): Promise<string[]> => {
  let installed: string[] = [];
  try {
    installed = listEnabledAddons(await getDb())
      .filter((a) => a.manifest.resources.includes('subtitles'))
      .map((a) => a.baseUrl);
  } catch {
    installed = [];
  }
  return [...new Set([...config.subtitles.addons, ...installed])];
};
