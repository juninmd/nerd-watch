import type { AddonStreamDto } from '../api/stremio.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { parseStreamDetails } from './stream-details.ts';

export interface StreamCardAction {
  /** Atributos `data-*` do botão de ação (ex.: `data-play="0"` ou `data-addon="x" data-index="0"`). */
  buttonAttrs: string;
}

const badgeClass = (tone: 'accent' | 'neutral' | 'warn'): string =>
  tone === 'accent' ? 'stream-badge stream-badge-accent' : tone === 'warn' ? 'stream-badge stream-badge-warn' : 'stream-badge';

/**
 * Cartão detalhado de um stream do Stremio: mostra cabeçalho, selos de resolução/codec/áudio/tamanho/seeds,
 * descrição completa preservando quebras de linha e metadados técnicos (arquivo, trackers, servidor).
 */
export const streamCardHtml = (s: AddonStreamDto, action: StreamCardAction): string => {
  const details = parseStreamDetails(s);
  const badgesHtml = details.badges.length
    ? `<div class="stream-badges">${details.badges
        .map((b) => `<span class="${badgeClass(b.tone)}">${escapeHtml(b.label)}</span>`)
        .join('')}</div>`
    : '';
  const descHtml = details.lines.length
    ? `<div class="stream-desc">${details.lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>`
    : '';
  const metaHtml = details.meta.length
    ? `<div class="stream-meta">${details.meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div>`
    : '';

  const actionHtml =
    s.kind === 'external'
      ? `<a class="btn btn-ghost btn-sm stream-action" href="${escapeHtml(s.url ?? '')}" target="_blank" rel="noopener noreferrer">${icon('forward', 'sm')} Abrir fora</a>`
      : `<button type="button" class="btn btn-primary btn-sm stream-action" ${action.buttonAttrs}>${icon(s.kind === 'torrent' ? 'download' : 'play', 'sm')} ${s.kind === 'torrent' ? 'Assistir P2P' : 'Assistir'}</button>`;

  return `<li class="stream-card${s.kind === 'torrent' ? ' stream-torrent' : ''}">
    <div class="stream-card-head">
      <strong class="stream-card-title">${escapeHtml(details.heading)}</strong>
      ${actionHtml}
    </div>
    ${badgesHtml}
    ${descHtml}
    ${metaHtml}
  </li>`;
};
