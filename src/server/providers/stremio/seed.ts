import { getDb } from '../../db/database.ts';
import { listAddons, saveAddon } from '../../repo/stremio-addons.ts';
import { fetchManifestFrom } from './protocol.ts';
import { parseAddonUrl } from './url.ts';

/**
 * Instala, no boot, os addons listados em `ADDON_MANIFEST_URLS`. Existe para o caso "quero este addon
 * sempre que o app subir" sem escrever o link em código: o valor vem do ambiente (`.env` ou segredo do
 * repositório) porque o caminho do manifest pode ter token.
 *
 * Regras que importam:
 * - nada acontece sem a variável; a instalação manual pela tela continua sendo o caminho padrão;
 * - o link passa pelo mesmo `parseAddonUrl`/`fetchManifestFrom` da instalação manual (host público,
 *   sem query, manifesto válido) — ambiente não é atalho para furar validação;
 * - falha de um addon é registrada só com o host (o caminho pode ter token) e não impede o boot.
 */
export const seedAddonsFromConfig = async (urls: readonly string[]): Promise<number> => {
  if (urls.length === 0) return 0;

  const hostOf = (url: string): string => {
    try {
      return new URL(url).host;
    } catch {
      return 'link inválido';
    }
  };

  const db = await getDb();
  const installed = new Set(listAddons(db).map((addon) => addon.manifestUrl));
  let added = 0;

  for (const url of urls) {
    try {
      const parsed = parseAddonUrl(url);
      if (installed.has(parsed.manifestUrl)) continue;
      const manifest = await fetchManifestFrom(parsed.manifestUrl);
      saveAddon(db, { manifestUrl: parsed.manifestUrl, baseUrl: parsed.baseUrl, manifest });
      installed.add(parsed.manifestUrl);
      added++;
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'erro';
      console.warn(`[addons] não instalei o addon de ${hostOf(url)} (${reason})`);
    }
  }

  return added;
};
