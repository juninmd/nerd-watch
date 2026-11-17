import { escapeHtml } from './card.ts';
import { icon } from './icons.ts';

/** Link de retorno no topo de telas de detalhe. `href` é o destino de reserva (aba aberta direto na tela). */
export const backLinkHtml = (href: string, label: string, useHistory = false): string =>
  `<a class="back-link" href="${escapeHtml(href)}"${useHistory ? ' data-history-back' : ''}>${icon('back', 'sm')} ${escapeHtml(label)}</a>`;

/** Um só ouvinte no documento: os links `data-history-back` voltam à tela de origem (busca, lista, início…) em vez de um destino fixo. */
export const installHistoryBack = (): void => {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[data-history-back]');
    if (!a || e.defaultPrevented || history.length <= 1) return; // sem histórico: o href leva ao destino de reserva
    e.preventDefault();
    history.back();
  });
};
