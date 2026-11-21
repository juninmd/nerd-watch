import { icon } from '../ui/icons.ts';
import { addTitlesToList, createList, listLists, removeTitleFromList, type ListSummaryDto } from '../api/lists.ts';
import { showToast } from '../app/state.ts';
import { escapeHtml } from '../ui/card.ts';

let seq = 0;

/**
 * "Adicionar à lista" na página do título: um painel com uma caixa por lista (marcada = o título está nela) e um campo
 * para criar uma lista nova já com o título dentro. Cada marcação grava na hora; o estado é anunciado numa região viva.
 */
export const renderAddToList = (titleId: string): HTMLElement => {
  const uid = `atl-${++seq}`;
  const wrap = document.createElement('div');
  wrap.className = 'add-to-list';
  wrap.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" aria-expanded="false" aria-controls="${uid}-panel">${icon('plus', 'sm')} Adicionar à lista</button>
    <div class="atl-panel" id="${uid}-panel" hidden>
      <fieldset class="atl-options">
        <legend>Listas</legend>
        <p class="atl-empty" hidden>Nenhuma lista ainda. Crie uma abaixo.</p>
        <div class="atl-checks"></div>
      </fieldset>
      <form class="atl-new">
        <label class="sr-only" for="${uid}-new">Nome da nova lista</label>
        <input id="${uid}-new" class="input input-pill" type="text" maxlength="80" placeholder="nova lista…" autocomplete="off" />
        <button type="submit" class="btn btn-ghost btn-sm">Criar e adicionar</button>
      </form>
      <p class="atl-status" role="status" aria-live="polite"></p>
    </div>`;

  const toggle = wrap.querySelector('button') as HTMLButtonElement;
  const panel = wrap.querySelector('.atl-panel') as HTMLElement;
  const checks = wrap.querySelector('.atl-checks') as HTMLElement;
  const empty = wrap.querySelector('.atl-empty') as HTMLElement;
  const status = wrap.querySelector('.atl-status') as HTMLElement;
  const newForm = wrap.querySelector('.atl-new') as HTMLFormElement;
  const newInput = wrap.querySelector('.atl-new input') as HTMLInputElement;
  const newSubmit = wrap.querySelector('.atl-new button[type="submit"]') as HTMLButtonElement;
  let loadSeq = 0;

  const announce = (message: string) => {
    status.textContent = message;
  };

  const paintChecks = (lists: ListSummaryDto[]) => {
    empty.hidden = lists.length > 0;
    checks.innerHTML = lists
      .map(
        (l, i) =>
          `<label class="atl-check"><input type="checkbox" data-list="${escapeHtml(l.id)}" data-index="${i}"${l.containsTitle ? ' checked' : ''} /> <span>${escapeHtml(l.name)}</span></label>`,
      )
      .join('');
  };

  const load = () => {
    const seq = ++loadSeq;
    return listLists({ limit: 100, titleId })
      .then((page) => {
        if (!wrap.isConnected || seq !== loadSeq) return;
        paintChecks(page.items);
      })
      .catch(() => {
        if (!wrap.isConnected || seq !== loadSeq) return;
        announce('não foi possível carregar as listas');
      });
  };

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) void load();
  });

  checks.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    const listId = box.dataset.list;
    if (!listId || box.disabled) return;
    box.disabled = true;
    const name = box.closest('label')?.querySelector('span')?.textContent ?? 'lista';
    const request = box.checked ? addTitlesToList(listId, [titleId]) : removeTitleFromList(listId, titleId);
    request
      .then(() => {
        const message = box.checked ? `adicionado a "${name}"` : `removido de "${name}"`;
        showToast(message);
        if (wrap.isConnected) announce(message);
      })
      .catch((err: unknown) => {
        if (!wrap.isConnected) return;
        box.checked = !box.checked;
        announce(err instanceof Error ? err.message : 'não foi possível atualizar a lista');
      })
      .finally(() => {
        if (box.isConnected) box.disabled = false;
      });
  });

  newForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (newSubmit.disabled) return;
    const name = newInput.value.trim();
    if (!name) return;
    newSubmit.disabled = true;
    createList({ name })
      .then((list) => addTitlesToList(list.id, [titleId]).then(() => list))
      .then((list) => {
        const message = `lista "${list.name}" criada com este título`;
        showToast(message);
        if (!wrap.isConnected) return;
        newInput.value = '';
        announce(message);
        return load();
      })
      .catch((err: unknown) => {
        if (!wrap.isConnected) return;
        announce(err instanceof Error ? err.message : 'não foi possível criar a lista');
        // Se a lista foi criada e só a adição falhou, recarregar mostra a lista vazia em vez de criar outra no próximo clique.
        void load();
      })
      .finally(() => {
        if (newSubmit.isConnected) newSubmit.disabled = false;
      });
  });

  return wrap;
};
