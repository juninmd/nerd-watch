import { escapeHtml, posterCssUrl } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { createList, listLists, type ListSummaryDto } from '../api/lists.ts';
import { listLibrary } from '../api/library.ts';
import { listSavedViews } from '../api/saved-views.ts';
import { smartLists, type SmartList } from './smart-lists.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';

const PAGE = 48;

const plural = (n: number): string => `${n} título${n === 1 ? '' : 's'}`;

/** Cartão com as primeiras capas da lista (mosaico); sem capa, um bloco com o gradiente da marca. */
const cardHtml = (list: ListSummaryDto): string => {
  const covers = list.covers.slice(0, 4);
  const mosaic =
    covers.length === 0
      ? '<span class="list-cover empty" aria-hidden="true"></span>'
      : covers
          .map((c) => `<span class="list-cover"${c.posterUrl ? ` style="${escapeHtml(`background-image:${posterCssUrl(c.posterUrl)}`)}"` : ''} aria-hidden="true"></span>`)
          .join('');
  return `<a class="list-card" href="#/lists/${encodeURIComponent(list.id)}" aria-label="${escapeHtml(list.name)}, ${plural(list.itemCount)}">
      <span class="list-mosaic">${mosaic}</span>
      <span class="list-name">${escapeHtml(list.name)}</span>
      <span class="list-sub">${plural(list.itemCount)}</span>
    </a>`;
};

/** Mesmo cartão das listas comuns, com a regra no lugar do contador seco; leva à biblioteca já filtrada. */
const smartCardHtml = (l: SmartList): string => {
  const covers = l.covers.length
    ? l.covers.map((c) => `<span class="list-cover"${c ? ` style="${escapeHtml(`background-image:${posterCssUrl(c)}`)}"` : ''} aria-hidden="true"></span>`).join('')
    : '<span class="list-cover empty" aria-hidden="true"></span>';
  return `<a class="list-card" href="#/library?view=${encodeURIComponent(l.id)}" aria-label="${escapeHtml(l.name)}, ${plural(l.count)}, lista inteligente">
      <span class="list-mosaic">${covers}</span>
      <span class="list-name">${escapeHtml(l.name)}</span>
      <span class="list-sub">${plural(l.count)} · ${escapeHtml(l.rule)}</span>
    </a>`;
};

/** Listas próprias: grade de cartões com capas, criação rápida e "carregar mais" (sem lista de tamanho ilimitado na tela). */
export const renderLists = (host: HTMLElement): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Listas</h1>
      <p class="view-subtitle">Coleções suas, só neste computador. Um título pode estar em várias listas.</p>
    </header>
    <form class="lists-new" id="lists-new">
      <label class="sr-only" for="lists-new-name">Nome da nova lista</label>
      <input id="lists-new-name" class="input input-pill" type="text" maxlength="80" required placeholder="nome da nova lista" autocomplete="off" />
      <button type="submit" class="btn btn-primary btn-sm">${icon('plus', 'sm')} criar lista</button>
    </form>
    <div id="lists-grid" class="list-grid"><div class="skeleton" style="aspect-ratio:2/1"></div></div>
    <div id="lists-more"></div>
    <section id="lists-smart" hidden>
      <h2 class="view-title" style="font-size:var(--text-lg)">Listas inteligentes</h2>
      <p class="view-subtitle">Visões salvas da biblioteca. Elas se atualizam sozinhas conforme você marca e avalia. Crie novas na <a href="#/library">biblioteca</a>.</p>
      <div id="lists-smart-grid" class="list-grid"></div>
    </section>`;

  const grid = host.querySelector('#lists-grid') as HTMLElement;
  const more = host.querySelector('#lists-more') as HTMLElement;
  const smartSection = host.querySelector('#lists-smart') as HTMLElement;
  const smartGrid = host.querySelector('#lists-smart-grid') as HTMLElement;
  let shown: ListSummaryDto[] = [];
  let loading = false;

  const paint = (total: number) => {
    if (shown.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="big" aria-hidden="true">${icon('folder')}</div>nenhuma lista ainda — crie a primeira acima, ou adicione títulos a uma lista pela página do título</div>`;
    } else {
      grid.innerHTML = shown.map(cardHtml).join('');
    }
    more.innerHTML =
      shown.length < total ? `<button type="button" class="btn btn-ghost btn-sm" id="lists-load-more">carregar mais (${total - shown.length})</button>` : '';
  };

  const load = (offset: number) => {
    if (loading) return Promise.resolve();
    loading = true;
    const moreBtn = more.querySelector<HTMLButtonElement>('#lists-load-more');
    if (moreBtn) moreBtn.disabled = true;
    return listLists({ limit: PAGE, offset })
      .then((page) => {
        loading = false;
        if (!grid.isConnected) return;
        shown = offset === 0 ? page.items : [...shown, ...page.items];
        paint(page.total);
      })
      .catch(() => {
        loading = false;
        if (!grid.isConnected) return;
        if (moreBtn?.isConnected) moreBtn.disabled = false;
        if (offset === 0) {
          grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="big" aria-hidden="true">${icon('alert')}</div>não foi possível carregar as listas</div>`;
        } else {
          showToast('não foi possível carregar mais listas');
        }
      });
  };

  more.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#lists-load-more')) void load(shown.length);
  });

  const form = host.querySelector('#lists-new') as HTMLFormElement;
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  let creating = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (creating) return;
    const input = host.querySelector('#lists-new-name') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    creating = true;
    if (submitBtn) submitBtn.disabled = true;
    createList({ name })
      .then((list) => {
        creating = false;
        if (!grid.isConnected) return;
        showToast(`lista "${list.name}" criada`);
        navigate(`/lists/${encodeURIComponent(list.id)}`);
      })
      .catch((err: unknown) => {
        creating = false;
        if (submitBtn?.isConnected) submitBtn.disabled = false;
        if (!grid.isConnected) return;
        showToast(err instanceof Error ? err.message : 'não foi possível criar a lista');
      });
  });

  // Falha aqui não derruba as listas comuns, mas a seção avisa em vez de sumir sem explicação.
  void Promise.all([listSavedViews(), listLibrary()])
    .then(([views, lib]) => {
      if (!smartGrid.isConnected) return;
      const smart = smartLists(views.items, lib.items);
      if (smart.length === 0) return;
      smartGrid.innerHTML = smart.map(smartCardHtml).join('');
      smartSection.hidden = false;
    })
    .catch(() => {
      if (!smartGrid.isConnected) return;
      smartGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="big" aria-hidden="true">${icon('alert')}</div>não foi possível carregar as listas inteligentes agora</div>`;
      smartSection.hidden = false;
    });

  void load(0);
};
