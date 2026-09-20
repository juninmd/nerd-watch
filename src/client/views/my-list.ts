import { listLibrary, type LibraryItemDto } from '../api.ts';
import type { WatchStatus } from '../../server/types.ts';
import { renderCard } from '../components/card.ts';
import { navigate } from '../router.ts';
import { titlePath } from '../title-link.ts';

const FILTERS: Array<{ value: WatchStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'watching', label: 'Assistindo' },
  { value: 'want', label: 'Quero ver' },
  { value: 'watched', label: 'Assistido' },
  { value: 'dropped', label: 'Abandonado' },
];

export const renderMyList = (host: HTMLElement): void => {
  let active: WatchStatus | 'all' = 'all';

  host.innerHTML = `
    <h1 class="view-title">Minha lista</h1>
    <p class="view-subtitle">Tudo o que você marcou, de "quero ver" a "abandonado".</p>
    <div class="chip-row" id="filters" style="margin-bottom:22px"></div>
    <div id="list"><div class="grid">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div></div>
  `;

  const filtersEl = host.querySelector('#filters') as HTMLElement;
  const listEl = host.querySelector('#list') as HTMLElement;
  let allItems: LibraryItemDto[] = [];

  const renderFilters = () => {
    filtersEl.innerHTML = FILTERS.map(
      (f) => `<button class="chip${active === f.value ? ' active' : ''}" data-value="${f.value}">${f.label}</button>`,
    ).join('');
    filtersEl.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        active = btn.dataset.value as WatchStatus | 'all';
        renderFilters();
        renderList();
      });
    });
  };

  const renderList = () => {
    const items = active === 'all' ? allItems : allItems.filter((i) => i.watchStatus === active);
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><div class="big">📭</div>nada aqui ainda — <a href="#/search">busque algo</a> para adicionar</div>`;
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const item of items) {
      grid.appendChild(
        renderCard({
          title: item.title.title,
          posterUrl: item.title.posterUrl,
          meta:
            item.currentSeason && item.title.mediaType === 'tv'
              ? `T${item.currentSeason} · Ep ${item.currentEpisode}`
              : item.title.releaseDate?.slice(0, 4),
          status: item.watchStatus,
          onClick: () => navigate(titlePath(item.title.source, item.title.mediaType, item.title.sourceId)),
        }),
      );
    }
    listEl.innerHTML = '';
    listEl.appendChild(grid);
  };

  renderFilters();

  listLibrary()
    .then((data) => {
      allItems = data.items;
      renderList();
    })
    .catch(() => {
      listEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar sua lista</div>`;
    });
};
