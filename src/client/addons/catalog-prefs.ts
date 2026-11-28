import type { AddonBoardDto, AddonItemDto } from '../api/stremio.ts';

/**
 * Ordem, catálogos ocultos e "Meu feed" da tela Descobrir (o `Catalogs.kt` do stream-goat).
 * Guardado por chave estável `addonId:type:catalogId`: reinstalar o addon mantém a escolha. Núcleo puro.
 */
export interface CatalogPrefs {
  order: string[];
  hidden: string[];
  feed: boolean;
}

const KEY = 'nw.discover.catalogs';
/** Teto do que fica guardado: chaves de addons removidos não crescem sem limite. */
export const PREFS_KEYS_MAX = 200;
export const FEED_ITEMS = 20;

export const defaultPrefs = (): CatalogPrefs => ({ order: [], hidden: [], feed: false });

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, PREFS_KEYS_MAX) : []);

export const readCatalogPrefs = (): CatalogPrefs => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CatalogPrefs> | null;
    if (!v || typeof v !== 'object') return defaultPrefs();
    return { order: strings(v.order), hidden: strings(v.hidden), feed: v.feed === true };
  } catch {
    return defaultPrefs();
  }
};

export const saveCatalogPrefs = (p: CatalogPrefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Sem storage: a escolha vale só nesta visita.
  }
};

/** Ordem escolhida primeiro; catálogos novos entram no fim, na ordem padrão de quem chamou. */
export const arrangeBoards = (boards: readonly AddonBoardDto[], prefs: CatalogPrefs): AddonBoardDto[] => {
  const pos = new Map(prefs.order.map((k, i) => [k, i]));
  return boards
    .map((b, i) => ({ b, at: pos.get(b.key) ?? prefs.order.length + i }))
    .sort((x, y) => x.at - y.at)
    .map((x) => x.b);
};

export const visibleBoards = (boards: readonly AddonBoardDto[], prefs: CatalogPrefs): AddonBoardDto[] =>
  arrangeBoards(boards, prefs).filter((b) => !prefs.hidden.includes(b.key));

/** Sobe/desce um catálogo; devolve a ordem completa já materializada. */
export const moveBoard = (boards: readonly AddonBoardDto[], prefs: CatalogPrefs, key: string, dir: -1 | 1): CatalogPrefs => {
  const keys = arrangeBoards(boards, prefs).map((b) => b.key);
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return prefs;
  [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  return { ...prefs, order: keys };
};

export const toggleHidden = (prefs: CatalogPrefs, key: string, hide: boolean): CatalogPrefs => ({
  ...prefs,
  hidden: hide ? [...new Set([...prefs.hidden, key])] : prefs.hidden.filter((k) => k !== key),
});

/** "Meu feed": intercala os catálogos visíveis (um de cada por vez), sem repetir o mesmo título. */
export const mergeFeed = (lists: readonly AddonItemDto[][], max = FEED_ITEMS): AddonItemDto[] => {
  const out: AddonItemDto[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && out.length < max; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item) continue;
      const k = `${item.type}:${item.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
      if (out.length >= max) break;
    }
  }
  return out;
};
