import type { InstalledAddon } from '../../repo/stremio-addons.ts';

/**
 * "Quadro" = um catálogo publicado por um addon instalado (`type` + `id`), já achatado com o nome do
 * addon e os filtros que ele declara. É a lista que a tela Descobrir usa para montar os trilhos.
 *
 * Função pura, sem rede: tudo vem do manifest que já está no banco.
 */
export interface AddonBoard {
  /** Chave estável na interface: `addonId:type:catalogId`. */
  key: string;
  addonId: string;
  addonName: string;
  logo: string | null;
  /** Só o domínio: o caminho do manifest pode ter token e nunca sai do servidor. */
  host: string;
  type: string;
  catalogId: string;
  name: string;
  searchable: boolean;
  paged: boolean;
  genres: string[];
  yearFilter: boolean;
}

/** Teto de quadros: cada trilho é uma requisição externa na tela Descobrir. */
export const BOARDS_MAX = 60;

export const boardsOf = (addons: readonly InstalledAddon[]): AddonBoard[] => {
  const out: AddonBoard[] = [];
  for (const addon of addons) {
    if (!addon.manifest.resources.includes('catalog')) continue;
    const host = new URL(addon.baseUrl).host;
    for (const catalog of addon.manifest.catalogs) {
      if (out.length >= BOARDS_MAX) return out;
      out.push({
        key: `${addon.id}:${catalog.type}:${catalog.id}`,
        addonId: addon.id,
        addonName: addon.manifest.name,
        logo: addon.manifest.logo,
        host,
        type: catalog.type,
        catalogId: catalog.id,
        name: catalog.name,
        searchable: catalog.searchable,
        paged: catalog.paged,
        genres: catalog.genres,
        yearFilter: catalog.yearFilter,
      });
    }
  }
  return out;
};
