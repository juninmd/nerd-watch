import { escapeHtml } from './card.ts';
import { EMBED_ALLOW, EMBED_SANDBOX } from './watch-embed.ts';

const KEY_RE = /^[A-Za-z0-9_-]{6,32}$/;

/** Iframe do trailer; devolve '' para chave ausente ou fora do formato de id do YouTube (a chave vem de terceiro). */
export const trailerFrameHtml = (key: string | null | undefined): string => {
  if (!key || !KEY_RE.test(key)) return '';
  return `<div class="trailer-frame" id="trailer" tabindex="-1"><iframe src="https://www.youtube.com/embed/${escapeHtml(key)}" allowfullscreen title="trailer" sandbox="${EMBED_SANDBOX}" allow="${EMBED_ALLOW}" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
};
