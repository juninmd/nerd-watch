import { escapeHtml, posterCssUrl } from '../components/card.ts';
import { icon } from '../icons.ts';
import { createList, listLists, type ListSummaryDto } from '../lists-api.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';

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

/** Listas próprias: grade de cartões com capas, criação rápida e "carregar mais" (sem lista de tamanho ilimitado na tela). */
export const renderLists = (host: HTMLElement): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Listas</h1>
      <p class="view-subtitle">Coleções suas, só neste computador. Um título pode estar em várias listas.</p>
    </header>
    <form class="lists-new" id="lists-new">
      <label class="sr-only" for="lists-new-name">Nome da nova lista</label>
      <input id="lists-new-name" class="input-pill" type="text" maxlength="80" required placeholder="nome da nova lista" autocomplete="off" />
      <button type="submit" class="btn btn-primary btn-sm">${icon('plus', 'sm')} criar lista</button>
    </form>
    <div id="lists-grid" class="list-grid"><div class="skeleton" style="aspect-ratio:2/1"></div></div>
    <div id="lists-more"></div>`;

  const grid = host.querySelector('#lists-grid') as HTMLElement;
  const more = host.querySelector('#lists-more') as HTMLElement;
  let shown: ListSummaryDto[] = [];

  const paint = (total: number) => {
    if (shown.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="big">🗂️</div>nenhuma lista ainda — crie a primeira acima, ou adicione títulos a uma lista pela página do título</div>`;
    } else {
      grid.innerHTML = shown.map(cardHtml).join('');
    }
    more.innerHTML =
      shown.length < total ? `<button type="button" class="btn btn-ghost btn-sm" id="lists-load-more">carregar mais (${total - shown.length})</button>` : '';
  };

  const load = (offset: number) =>
    listLists({ limit: PAGE, offset })
      .then((page) => {
        shown = offset === 0 ? page.items : [...shown, ...page.items];
        paint(page.total);
      })
      .catch(() => {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="big">⚠️</div>não foi possível carregar as listas</div>`;
      });

  more.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#lists-load-more')) void load(shown.length);
  });

  (host.querySelector('#lists-new') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = host.querySelector('#lists-new-name') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    createList({ name })
      .then((list) => {
        showToast(`lista "${list.name}" criada`);
        navigate(`/lists/${encodeURIComponent(list.id)}`);
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'não foi possível criar a lista'));
  });

  void load(0);
};
