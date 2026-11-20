import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import { fetchCatalog, type MetaPreview } from './protocol.ts';

export interface AddonSearchHit extends MetaPreview {
  addonId: string;
  addonName: string;
}

/** Teto por addon e de catálogos consultados por addon: a busca é interativa e cada catálogo é uma chamada HTTP. */
const PER_ADDON = 12;
const CATALOGS_PER_ADDON = 3;

/**
 * Busca `query` nos catálogos pesquisáveis dos addons instalados. Falha de um catálogo não derruba os outros;
 * o mesmo item repetido entre catálogos do mesmo addon aparece uma vez.
 */
export const searchAddons = async (addons: InstalledAddon[], query: string, fetchFn: typeof fetchCatalog = fetchCatalog): Promise<AddonSearchHit[]> => {
  const perAddon = await Promise.all(
    addons.map(async (a): Promise<AddonSearchHit[]> => {
      if (!a.manifest.resources.includes('catalog')) return [];
      const catalogs = a.manifest.catalogs.filter((c) => c.searchable).slice(0, CATALOGS_PER_ADDON);
      const batches = await Promise.all(catalogs.map((c) => fetchFn(a.baseUrl, c.type, c.id, { search: query }).catch(() => [] as MetaPreview[])));
      const seen = new Set<string>();
      const hits: AddonSearchHit[] = [];
      for (const m of batches.flat()) {
        const key = `${m.type}:${m.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ ...m, addonId: a.id, addonName: a.manifest.name });
      }
      return hits.slice(0, PER_ADDON);
    }),
  );
  return perAddon.flat();
};
