import type { InstalledAddon } from '../../repo/stremio-addons.ts';
import { fetchCatalog, type MetaPreview } from './protocol.ts';

export interface AddonSearchHit extends MetaPreview {
  addonId: string;
  addonName: string;
}

/** Teto por addon e de catálogos consultados por addon: a busca é interativa e cada catálogo é uma chamada HTTP. */
const PER_ADDON = 12;
const CATALOGS_PER_ADDON = 3;
/** No filtro local o custo já é uma página; 4 cobre o par populares/recentes de filmes e de séries. */
const LOCAL_CATALOGS_PER_ADDON = 4;
/** Teto global de páginas extras por busca: 20 addons sem busca não podem virar 80 requisições. */
const LOCAL_FETCH_BUDGET = 8;

/** Comparação sem caixa e sem acento: o catálogo pode gravar "A Odisseia" e a pessoa digitar "odisseia". */
const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const matchesQuery = (name: string, needle: string): boolean => needle !== '' && fold(name).includes(needle);

/**
 * Busca `query` nos catálogos pesquisáveis dos addons instalados. Falha de um catálogo não derruba os outros;
 * o mesmo item repetido entre catálogos do mesmo addon aparece uma vez.
 *
 * Addon que não declara busca (como o FenixFlix) ficaria de fora por completo; nesse caso lemos a primeira
 * página dos catálogos e filtramos pelo nome aqui. É uma aproximação limitada ao que já veio na página, mas
 * faz o título aparecer na busca em vez de só existir em "explorar".
 */
export const searchAddons = async (addons: InstalledAddon[], query: string, fetchFn: typeof fetchCatalog = fetchCatalog): Promise<AddonSearchHit[]> => {
  const needle = fold(query.trim());
  let localBudget = LOCAL_FETCH_BUDGET;
  const perAddon = await Promise.all(
    addons.map(async (a): Promise<AddonSearchHit[]> => {
      if (!a.manifest.resources.includes('catalog')) return [];
      const searchable = a.manifest.catalogs.filter((c) => c.searchable).slice(0, CATALOGS_PER_ADDON);
      // Só cai no filtro local quando o addon não oferece busca no protocolo; assim um addon grande não
      // transforma cada pesquisa em dezenas de chamadas desnecessárias. A busca de uma letra só não
      // justifica varrer catálogo nenhum.
      const local: typeof a.manifest.catalogs = [];
      if (searchable.length === 0 && needle.length >= 2) {
        for (const c of a.manifest.catalogs) {
          if (c.searchable || localBudget <= 0 || local.length >= LOCAL_CATALOGS_PER_ADDON) continue;
          local.push(c);
          localBudget--;
        }
      }
      const [remoteBatches, localBatches] = await Promise.all([
        Promise.all(searchable.map((c) => fetchFn(a.baseUrl, c.type, c.id, { search: query }).catch(() => [] as MetaPreview[]))),
        Promise.all(local.map((c) => fetchFn(a.baseUrl, c.type, c.id, {}).catch(() => [] as MetaPreview[]))),
      ]);

      const seen = new Set<string>();
      const hits: AddonSearchHit[] = [];
      const collect = (items: MetaPreview[], onlyMatching: boolean): void => {
        for (const m of items) {
          if (onlyMatching && !matchesQuery(m.name, needle)) continue;
          const key = `${m.type}:${m.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ ...m, addonId: a.id, addonName: a.manifest.name });
        }
      };
      collect(remoteBatches.flat(), false);
      collect(localBatches.flat(), true);
      return hits.slice(0, PER_ADDON);
    }),
  );
  return perAddon.flat();
};
