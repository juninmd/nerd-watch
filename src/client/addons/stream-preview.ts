/**
 * Lista de streams de um addon pode vir enorme: o addon de torrent mais usado responde até **500**
 * streams por título (limite do banco dele, sem `skip`). Renderizar 500 cartões de uma vez trava a
 * rolagem e o aparelho. A tela mostra os primeiros e deixa abrir o resto sob demanda.
 *
 * Sem DOM: a regra de "quantos aparecem" é testável sozinha.
 */
export const STREAM_PREVIEW = 8;

/** Acima disso o addon está no teto dele (não é a lista completa do que existe). */
export const ADDON_STREAM_CAP = 500;

export interface StreamPreview<T> {
  visible: readonly T[];
  /** Quantos ficaram escondidos atrás do "mostrar todos". */
  hidden: number;
  total: number;
}

export const previewStreams = <T>(items: readonly T[], expanded: boolean, limit = STREAM_PREVIEW): StreamPreview<T> => {
  if (expanded || items.length <= limit) return { visible: items, hidden: 0, total: items.length };
  return { visible: items.slice(0, limit), hidden: items.length - limit, total: items.length };
};

/** A lista veio no teto do addon: a interface avisa em vez de fingir que aquilo é tudo. */
export const atAddonCap = (total: number): boolean => total >= ADDON_STREAM_CAP;
