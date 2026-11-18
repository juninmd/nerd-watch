import type { AddonDto } from '../api/stremio.ts';

/** Rotas das telas de addon. O id do item pode ter `:` e `/`, por isso vai codificado. */
export const addonPath = (addonId: string): string => `/addons/${encodeURIComponent(addonId)}`;
export const addonItemPath = (addonId: string, type: string, itemId: string): string => `${addonPath(addonId)}/${encodeURIComponent(type)}/${encodeURIComponent(itemId)}`;

/** Só quem declara `catalog` e tem catálogo listado dá para navegar. */
export const canBrowse = (addon: AddonDto): boolean => addon.resources.includes('catalog') && addon.catalogs.length > 0;

const RESOURCE_LABEL: Record<string, string> = { catalog: 'catálogo', meta: 'detalhes', stream: 'streams', subtitles: 'legendas' };

/** Rótulo pt-BR do recurso do protocolo; desconhecido aparece como veio (já truncado pelo servidor). */
export const resourceLabel = (name: string): string => RESOURCE_LABEL[name] ?? name;

/** O que o addon entrega, em uma frase: addon só de streams não lista títulos, e a tela precisa dizer isso. */
export const capabilitySummary = (addon: AddonDto): string => {
  const has = (r: string) => addon.resources.includes(r);
  if (canBrowse(addon)) return `${addon.catalogs.length} ${addon.catalogs.length === 1 ? 'catálogo' : 'catálogos'}: use "explorar" para ver os títulos.`;
  if (has('catalog')) return 'declara catálogo, mas não listou nenhum: não há títulos para explorar.';
  if (has('stream')) return 'só streams, sem catálogo: não lista títulos. Abra um filme ou série e os streams dele aparecem na página do título (via IMDb).';
  if (has('subtitles')) return 'só legendas: aparece no painel de legendas dos títulos.';
  return 'não declara catálogo nem streams: nada para exibir.';
};
