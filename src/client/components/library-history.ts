import { getLibraryHistory, type LibraryHistoryItemDto } from '../api.ts';
import { describeHistoryEvent } from '../library-history-format.ts';
import { escapeHtml } from './card.ts';

const PAGE_SIZE = 20;

const whenLabel = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Histórico recolhido por padrão. `<details>` dá teclado (Enter/Espaço no resumo) e leitor de tela de graça. */
export const renderLibraryHistory = (titleId: string): HTMLElement => {
  const wrap = document.createElement('details');
  wrap.className = 'conn-more history-details';
  wrap.innerHTML = `<summary>Histórico</summary><div class="history-body"><ol class="history-list"></ol><p class="history-status" aria-live="polite"></p><button type="button" class="btn btn-ghost btn-sm history-more" hidden>Ver mais</button></div>`;
  const list = wrap.querySelector<HTMLOListElement>('.history-list') as HTMLOListElement;
  const status = wrap.querySelector<HTMLParagraphElement>('.history-status') as HTMLParagraphElement;
  const more = wrap.querySelector<HTMLButtonElement>('.history-more') as HTMLButtonElement;

  let offset = 0;
  let loaded = false;
  let loading = false;

  const setStatus = (text: string): void => {
    status.textContent = text;
  };

  const load = (): void => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    getLibraryHistory(titleId, PAGE_SIZE, offset)
      .then((page) => {
        loaded = true;
        const firstNew = list.children.length;
        for (const item of page.items as LibraryHistoryItemDto[]) {
          const li = document.createElement('li');
          li.innerHTML = `<time datetime="${escapeHtml(item.at)}">${whenLabel(item.at)}</time> <span>${escapeHtml(describeHistoryEvent(item.kind, item.detail))}</span>`;
          list.appendChild(li);
        }
        offset += page.items.length;
        setStatus(page.total === 0 ? 'Nenhum evento registrado ainda.' : '');
        more.hidden = offset >= page.total;
        // Foco no primeiro item novo: sem isso, teclado e leitor de tela voltam ao topo ao "Ver mais".
        const target = list.children[firstNew];
        if (target instanceof HTMLElement && firstNew > 0) {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
      })
      .catch(() => {
        // Erro não apaga o que já foi carregado: só avisa e deixa tentar de novo.
        setStatus('Não foi possível carregar o histórico. Tente de novo.');
      })
      .finally(() => {
        loading = false;
        more.disabled = false;
      });
  };

  more.addEventListener('click', () => load());
  wrap.addEventListener('toggle', () => {
    if (wrap.open && !loaded) load();
  });
  return wrap;
};
