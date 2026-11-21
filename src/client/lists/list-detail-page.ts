import { moveItem } from '../../server/lists/rules.ts';
import { escapeHtml, posterStyleAttr } from '../ui/card.ts';
import { backLinkHtml } from '../ui/back-link.ts';
import { icon } from '../ui/icons.ts';
import { deleteList, getAllListItems, reorderList, removeTitleFromList, updateList, type ListItemDto, type ListSummaryDto } from '../api/lists.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { libraryItemPath } from '../ui/title-link.ts';

/** Detalhe de uma lista: itens em ordem, com subir/descer por botão (teclado e mouse), remover, editar e excluir. */
export const renderListDetail = (host: HTMLElement, listId: string): void => {
  // Raiz nova a cada visita: o #view é reaproveitado e ouvintes de uma lista não podem sobreviver à próxima.
  const root = document.createElement('div');
  host.replaceChildren(root);
  root.innerHTML = `<div class="skeleton" style="height:240px;border-radius:20px"></div>`;
  let list: ListSummaryDto | null = null;
  let items: ListItemDto[] = [];
  let editing = false;
  /** Uma reordenação por vez: um clique novo antes da resposta enviaria uma ordem calculada sobre a base antiga. */
  let busy = false;

  const paint = () => {
    if (!list) return;
    const total = items.length;
    const rows = items
      .map((item, i) => {
        const name = escapeHtml(item.title.title);
        const year = escapeHtml(item.title.releaseDate?.slice(0, 4) ?? '');
        const poster = posterStyleAttr(item.title.posterUrl);
        return `<li class="list-item" tabindex="-1" data-index="${i}">
          <span class="list-pos" aria-hidden="true">${i + 1}</span>
          <span class="list-thumb"${poster} aria-hidden="true"></span>
          <a class="list-item-title" href="#${libraryItemPath(item)}">${name}${year ? ` <small>${year}</small>` : ''}</a>
          <span class="list-item-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-move="-1" aria-label="Subir ${name} na lista" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-move="1" aria-label="Descer ${name} na lista" ${i === total - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="btn btn-ghost btn-sm" data-remove="${escapeHtml(item.titleId)}" aria-label="Remover ${name} da lista">${icon('x', 'sm')}</button>
          </span>
        </li>`;
      })
      .join('');
    root.innerHTML = `
      <header class="view-head list-head">
        ${backLinkHtml('#/lists', 'Listas')}
        <h1 class="view-title">${escapeHtml(list.name)}</h1>
        ${list.description ? `<p class="view-subtitle">${escapeHtml(list.description)}</p>` : ''}
        <p class="list-meta">${total} título${total === 1 ? '' : 's'}</p>
        <div class="list-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="list-edit" aria-expanded="${editing}">Editar nome e descrição</button>
          <button type="button" class="btn btn-danger btn-sm" id="list-delete">${icon('trash', 'sm')} excluir lista</button>
        </div>
      </header>
      ${
        editing
          ? `<form class="list-edit" id="list-edit-form">
              <label for="list-name-input">Nome</label>
              <input id="list-name-input" class="input input-pill" type="text" maxlength="80" required value="${escapeHtml(list.name)}" />
              <label for="list-desc-input">Descrição (opcional)</label>
              <textarea id="list-desc-input" class="textarea" maxlength="500" rows="2">${escapeHtml(list.description ?? '')}</textarea>
              <div><button type="submit" class="btn btn-primary btn-sm">Salvar</button> <button type="button" class="btn btn-ghost btn-sm" id="list-edit-cancel">Cancelar</button></div>
            </form>`
          : ''
      }
      ${
        total === 0
          ? `<div class="empty-state"><div class="big" aria-hidden="true">${icon('folder')}</div>lista vazia — adicione títulos pela página de cada um ("Adicionar à lista") ou pela Biblioteca</div>`
          : `<ol class="list-items" aria-label="Itens da lista, em ordem">${rows}</ol>`
      }
      <p class="list-status" role="status" aria-live="polite"></p>`;
  };

  const status = (message: string) => {
    const el = root.querySelector('.list-status');
    if (el) el.textContent = message;
  };

  /** Reordena com o servidor e devolve o foco ao mesmo item na nova posição (o botão recriado perderia o foco). */
  const move = (index: number, delta: -1 | 1) => {
    if (busy) return;
    const ids = items.map((i) => i.titleId);
    const next = moveItem(ids, index, delta);
    const newIndex = next.indexOf(ids[index] ?? '');
    const moved = items[index];
    if (!moved || newIndex === index) return;
    busy = true;
    reorderList(listId, next)
      .then((res) => {
        busy = false;
        if (!root.isConnected) return;
        // A ordem vem do servidor, não do cálculo local: é ela que ficou gravada.
        const byId = new Map(items.map((i) => [i.titleId, i]));
        items = res.titleIds.map((id) => byId.get(id)).filter((i): i is ListItemDto => i !== undefined);
        paint();
        root.querySelector<HTMLElement>(`[data-index="${newIndex}"]`)?.focus();
        status(`${moved.title.title} movido para a posição ${newIndex + 1} de ${items.length}`);
      })
      .catch((err: unknown) => {
        busy = false;
        if (!root.isConnected) return;
        status(err instanceof Error ? err.message : 'não foi possível reordenar');
      });
  };

  const load = () =>
    getAllListItems(listId)
      .then((data) => {
        if (!root.isConnected) return;
        list = data.list;
        items = data.items;
        paint();
      })
      .catch(() => {
        if (!root.isConnected) return;
        root.innerHTML = `<div class="empty-state"><div class="big" aria-hidden="true">${icon('alert')}</div>lista não encontrada ou indisponível <a href="#/lists">voltar às listas</a></div>`;
      });

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const moveBtn = target.closest<HTMLElement>('[data-move]');
    if (moveBtn) {
      const row = moveBtn.closest<HTMLElement>('[data-index]');
      move(Number(row?.dataset.index), Number(moveBtn.dataset.move) as -1 | 1);
      return;
    }
    const removeBtn = target.closest<HTMLButtonElement>('[data-remove]');
    if (removeBtn?.dataset.remove) {
      if (busy) return;
      const titleId = removeBtn.dataset.remove;
      const name = items.find((i) => i.titleId === titleId)?.title.title ?? 'título';
      busy = true;
      removeBtn.disabled = true;
      removeTitleFromList(listId, titleId)
        .then(() => {
          busy = false;
          if (!root.isConnected) return;
          items = items.filter((i) => i.titleId !== titleId);
          paint();
          status(`${name} removido da lista`);
          showToast(`${name} removido da lista`);
        })
        .catch((err: unknown) => {
          busy = false;
          if (!root.isConnected) return;
          if (removeBtn.isConnected) removeBtn.disabled = false;
          status(err instanceof Error ? err.message : 'não foi possível remover');
        });
      return;
    }
    if (target.closest('#list-edit')) {
      editing = !editing;
      paint();
      root.querySelector<HTMLInputElement>('#list-name-input')?.focus();
      return;
    }
    if (target.closest('#list-edit-cancel')) {
      editing = false;
      paint();
      root.querySelector<HTMLButtonElement>('#list-edit')?.focus();
      return;
    }
    const deleteBtn = target.closest<HTMLButtonElement>('#list-delete');
    if (deleteBtn && list) {
      if (busy) return;
      const name = list.name;
      if (!confirm(`Excluir a lista "${name}"? Os títulos continuam na biblioteca.`)) return;
      busy = true;
      deleteBtn.disabled = true;
      deleteList(listId)
        .then(() => {
          busy = false;
          if (!root.isConnected) return;
          showToast(`lista "${name}" excluída`);
          navigate('/lists');
        })
        .catch((err: unknown) => {
          busy = false;
          if (!root.isConnected) return;
          if (deleteBtn.isConnected) deleteBtn.disabled = false;
          status(err instanceof Error ? err.message : 'não foi possível excluir');
        });
    }
  });

  root.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (form.id !== 'list-edit-form') return;
    e.preventDefault();
    if (busy) return;
    const name = (root.querySelector('#list-name-input') as HTMLInputElement).value.trim();
    const description = (root.querySelector('#list-desc-input') as HTMLTextAreaElement).value;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    busy = true;
    if (submitBtn) submitBtn.disabled = true;
    updateList(listId, { name, description })
      .then((updated) => {
        busy = false;
        if (!root.isConnected) return;
        list = updated;
        editing = false;
        paint();
        status('nome e descrição salvos');
      })
      .catch((err: unknown) => {
        busy = false;
        if (!root.isConnected) return;
        if (submitBtn?.isConnected) submitBtn.disabled = false;
        status(err instanceof Error ? err.message : 'não foi possível salvar');
      });
  });

  void load();
};
