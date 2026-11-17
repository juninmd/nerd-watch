import type { AddonDto } from '../api/stremio.ts';

/** Rotas das telas de addon. O id do item pode ter `:` e `/`, por isso vai codificado. */
export const addonPath = (addonId: string): string => `/addons/${encodeURIComponent(addonId)}`;
export const addonItemPath = (addonId: string, type: string, itemId: string): string => `${addonPath(addonId)}/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}`;

/** Só quem declara `catalog` e tem catálogo listado dá para navegar. */
export const canBrowse = (addon: AddonDto): boolean => addon.resources.includes('catalog') && addon.catalogs.length > 0;

const RESOURCE_LABEL: Record<string, string> = { catalog: 'catálogo', meta: 'detalhes', stream: 'streams', subtitles: 'legendas' };

/** Rótulo pt-BR do recurso do protocolo; desconhecido aparece como veio (já truncado pelo servidor). */
export const resourceLabel = (name: string): string => RESOURCE_LABEL[name] ?? name;
