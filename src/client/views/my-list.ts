import { exportBackup, importBackup, listLibrary, type LibraryItemDto } from '../api.ts';
import type { WatchStatus } from '../../server/types.ts';
import { renderCard } from '../components/card.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
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
    <div class="chip-row" id="filters" style="margin-bottom:14px"></div>
    <div style="margin-bottom:22px;display:flex;gap:10px">
      <button class="btn btn-ghost btn-sm" id="btn-export">⬇️ exportar backup</button>
      <button class="btn btn-ghost btn-sm" id="btn-import">⬆️ importar backup</button>
      <input type="file" accept="application/json" id="import-file" style="display:none" />
    </div>
    <div id="list"><div class="grid">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div></div>
  `;

  const filtersEl = host.querySelector('#filters') as HTMLElement;
  const listEl = host.querySelector('#list') as HTMLElement;
  let allItems: LibraryItemDto[] = [];

  const loadList = () => {
    listLibrary()
      .then((data) => {
        allItems = data.items;
        renderList();
      })
      .catch(() => {
        listEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar sua lista</div>`;
      });
  };

  (host.querySelector('#btn-export') as HTMLButtonElement).addEventListener('click', async () => {
    try {
      const data = await exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nerd-watch-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('backup exportado');
    } catch {
      showToast('falha ao exportar backup');
    }
  });

  const importInput = host.querySelector('#import-file') as HTMLInputElement;
  (host.querySelector('#btn-import') as HTMLButtonElement).addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const res = await importBackup(data);
      showToast(
        `backup importado: ${res.imported.titles} títulos, ${res.imported.libraryEntries} na lista`,
      );
      loadList();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'falha ao importar backup');
    }
  });

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
  loadList();
};
