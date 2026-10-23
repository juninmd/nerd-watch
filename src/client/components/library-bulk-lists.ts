import { addTitlesToList, listLists } from '../lists-api.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

/**
 * Ação em lote da biblioteca: "adicionar selecionados a uma lista". O select volta ao placeholder depois de cada
 * escolha. Adicionar de novo é idempotente: o aviso diz quantos já estavam na lista.
 */
export const renderBulkAddToList = (getIds: () => string[]): HTMLSelectElement => {
  const select = document.createElement('select');
  select.className = 'select input-pill';
  select.setAttribute('aria-label', 'Adicionar selecionados a uma lista');
  select.innerHTML = '<option value="">adicionar à lista…</option>';

  listLists({ limit: 100 })
    .then((page) => {
      for (const list of page.items) {
        select.insertAdjacentHTML('beforeend', `<option value="${list.id}">${escapeHtml(list.name)}</option>`);
      }
    })
    .catch(() => {
      select.disabled = true;
    });

  select.addEventListener('change', () => {
    const listId = select.value;
    const ids = getIds();
    select.value = '';
    if (!listId || ids.length === 0) return;
    const name = select.querySelector<HTMLOptionElement>(`option[value="${listId}"]`)?.textContent ?? 'lista';
    addTitlesToList(listId, ids)
      .then((res) => showToast(`${res.added} adicionado(s) a "${name}"${res.existing > 0 ? `; ${res.existing} já estavam` : ''}`))
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'não foi possível adicionar à lista'));
  });

  return select;
};
