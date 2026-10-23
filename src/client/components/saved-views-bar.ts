import { serializeViewQuery, type LibraryViewQuery } from '../../server/saved-views/schema.ts';
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView, type SavedViewDto } from '../views-api.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';
import { invalidatePaletteData } from './command-palette.ts';

export interface SavedViewsBarOptions {
  /** Combinação atual da biblioteca (filtro, origem, ordem, layout): é o que "Salvar visão" grava. */
  currentQuery: () => LibraryViewQuery;
  /** Aplica a visão: a tela atualiza os controles e a lista de uma vez. */
  onApply: (view: SavedViewDto) => void;
}

export interface SavedViewsBar {
  el: HTMLElement;
  /** Busca as visões no servidor (ao abrir a tela e depois de criar, renomear ou apagar). */
  refresh: () => Promise<SavedViewDto[]>;
  /** Redesenha os chips sem ir ao servidor (ex.: quando a combinação atual muda). */
  sync: () => void;
  views: () => SavedViewDto[];
}

let seq = 0;

/** Chips das visões salvas, acima da biblioteca. Cada visão tem aplicar, renomear e excluir, todos por teclado. */
export const renderSavedViewsBar = (opts: SavedViewsBarOptions): SavedViewsBar => {
  const uid = `sv-${++seq}`;
  let views: SavedViewDto[] = [];
  let saving = false;
  const el = document.createElement('section');
  el.className = 'views-bar';
  el.setAttribute('aria-label', 'Visões salvas');

  const sameAs = (view: SavedViewDto): boolean => serializeViewQuery(view.query) === serializeViewQuery(opts.currentQuery());

  const paint = () => {
    const chips = views
      .map(
        (v) => `<span class="view-chip">
          <button type="button" class="chip${sameAs(v) ? ' active' : ''}" data-apply="${v.id}" aria-pressed="${sameAs(v)}">${escapeHtml(v.name)}</button>
          <button type="button" class="view-chip-act" data-rename="${v.id}" aria-label="Renomear visão ${escapeHtml(v.name)}">✎</button>
          <button type="button" class="view-chip-act" data-delete="${v.id}" aria-label="Excluir visão ${escapeHtml(v.name)}">×</button>
        </span>`,
      )
      .join('');
    el.innerHTML = `
      <div class="chip-row" role="group" aria-label="Aplicar visão salva">${chips}</div>
      <div class="views-actions">
        ${saving ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-save-open>Salvar visão atual</button>'}
        ${
          saving
            ? `<form class="views-form" data-save-form>
                <label class="sr-only" for="${uid}-name">Nome da visão</label>
                <input id="${uid}-name" class="input-pill" type="text" maxlength="40" required placeholder="nome da visão" autocomplete="off" />
                <button type="submit" class="btn btn-primary btn-sm">Salvar</button>
                <button type="button" class="btn btn-ghost btn-sm" data-save-cancel>Cancelar</button>
              </form>`
            : ''
        }
      </div>`;
    if (saving) el.querySelector<HTMLInputElement>('input')?.focus();
  };

  const refresh = () =>
    listSavedViews()
      .then((data) => {
        views = data.items;
        invalidatePaletteData();
        paint();
        return views;
      })
      .catch(() => {
        showToast('não foi possível carregar as visões salvas');
        return views;
      });

  /** Troca o chip pelo campo de renomear; Enter salva, Esc cancela. */
  const startRename = (id: string) => {
    const view = views.find((v) => v.id === id);
    const slot = el.querySelector<HTMLElement>(`[data-rename="${id}"]`)?.parentElement;
    if (!view || !slot) return;
    slot.innerHTML = `<form class="views-form" data-rename-form="${id}">
        <label class="sr-only" for="${uid}-rn">Novo nome da visão</label>
        <input id="${uid}-rn" class="input-pill" type="text" maxlength="40" required value="${escapeHtml(view.name)}" autocomplete="off" />
        <button type="submit" class="btn btn-primary btn-sm">Salvar nome</button>
        <button type="button" class="btn btn-ghost btn-sm" data-rename-cancel>Cancelar</button>
      </form>`;
    const input = slot.querySelector('input');
    input?.focus();
    input?.select();
    slot.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input?.value ?? '';
      updateSavedView(id, { name })
        .then((updated) => {
          showToast(`visão renomeada para "${updated.name}"`);
          return refresh();
        })
        .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'não foi possível renomear'));
    });
    slot.querySelector('[data-rename-cancel]')?.addEventListener('click', () => paint());
    slot.querySelector('form')?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') paint();
    });
  };

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const apply = target.closest<HTMLElement>('[data-apply]');
    if (apply) {
      const view = views.find((v) => v.id === apply.dataset.apply);
      if (view) opts.onApply(view);
      return;
    }
    const rename = target.closest<HTMLElement>('[data-rename]');
    if (rename?.dataset.rename) return startRename(rename.dataset.rename);
    const remove = target.closest<HTMLElement>('[data-delete]');
    if (remove?.dataset.delete) {
      const id = remove.dataset.delete;
      const view = views.find((v) => v.id === id);
      if (!view || !confirm(`Excluir a visão "${view.name}"? As listas e os títulos não mudam.`)) return;
      deleteSavedView(id)
        .then(() => {
          showToast(`visão "${view.name}" excluída`);
          return refresh();
        })
        .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'não foi possível excluir'));
      return;
    }
    if (target.closest('[data-save-open]')) {
      saving = true;
      paint();
      return;
    }
    if (target.closest('[data-save-cancel]')) {
      saving = false;
      paint();
    }
  });

  el.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (!form.matches('[data-save-form]')) return;
    e.preventDefault();
    if (saving === false) return;
    const name = (form.querySelector('input')?.value ?? '').trim();
    if (!name) return;
    createSavedView(name, opts.currentQuery())
      .then((view) => {
        saving = false;
        showToast(`visão "${view.name}" salva`);
        return refresh();
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'não foi possível salvar a visão'));
  });

  paint();
  return {
    el,
    refresh,
    sync: paint,
    views: () => views,
  };
};
