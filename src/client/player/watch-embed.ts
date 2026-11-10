/**
 * Item que toca por iframe (embed do YouTube/PeerTube) em vez do `<video>` do app. Lógica pura: sem DOM, para teste.
 * O `sandbox` isola a página externa da navegação do app (sem allow-top-navigation); scripts e same-origin ficam
 * porque o player do serviço precisa deles para tocar.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';
export const EMBED_ALLOW = 'encrypted-media; fullscreen; picture-in-picture';

/** Só https: a URL de embed vem do servidor, mas o navegador não a aceita às cegas. */
export const isEmbedUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Tira o arquivo do `<video>`: sem o `load()` ele segue com o frame antigo e uma posição poderia ser gravada no item errado. */
export const clearVideo = (el: HTMLVideoElement): void => {
  el.pause();
  el.removeAttribute('src');
  el.load();
};

export const playerKindOf =(item: { embedUrl?: string | null }): 'player' | 'embed' => (isEmbedUrl(item.embedUrl) ? 'embed' : 'player');

const attr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const embedFrameHtml = (url: string, title: string): string =>
  `<iframe src="${attr(url)}" title="${attr(title)}" sandbox="${EMBED_SANDBOX}" allow="${EMBED_ALLOW}" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
