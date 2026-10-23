import type { WatchStatus } from '../../server/types.ts';
import { bulkLibrary, listLibrary, type LibraryItemDto } from '../api.ts';
import { renderCard } from '../components/card.ts';
import { icon } from '../icons.ts';
import { openPickDialog } from '../components/pick-dialog.ts';
import { countByStatus, filterBySource, filterByStatus, type SourceFilter, type StatusFilter } from '../library-filter.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { libraryItemPath } from '../title-link.ts';

const TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'watching', label: 'Assistindo' },
  { value: 'want', label: 'Quero ver' },
  { value: 'watched', label: 'Assistido' },
  { value: 'dropped', label: 'Abandonado' },
];

const SOURCES: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'todas as origens' },
  { value: 'tmdb', label: 'filmes e séries' },
  { value: 'archive', label: 'domínio público' },
  { value: 'tvmaze', label: 'TVmaze' },
  { value: 'anilist', label: 'AniList' },
  { value: 'telegram', label: 'Telegram' },
];

const LAYOUT_KEY = 'nw.library.layout';
type Layout = 'grid' | 'list';

const loadLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

const saveLayout = (layout: Layout): void => {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // preferência só de conveniência
  }
};

const metaFor = (item: LibraryItemDto): string | undefined =>
  item.currentSeason && item.title.mediaType === 'tv' ? `T${item.currentSeason} · Ep ${item.currentEpisode}` : (item.title.releaseDate?.slice(0, 4) ?? undefined);

/** Biblioteca: tudo que o usuário marcou, com abas por status, filtro de origem, grade/lista e ações em lote. */
export const renderLibrary = (host: HTMLElement): void => {
  let status: StatusFilter = 'all';
  let source: SourceFilter = 'all';
  let layout = loadLayout();
  let items: LibraryItemDto[] = [];
  let selecting = false;
  const picked = new Set<string>();

  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Biblioteca</h1>
      <p class="view-subtitle">Tudo o que você marcou, de "quero ver" a "abandonado".</p>
    </header>
    <div class="toolbar">
      <div class="chip-row" id="lib-tabs" role="group" aria-label="Filtrar por status"></div>
      <select class="select input-pill" id="lib-source" aria-label="Filtrar por origem">${SOURCES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
      <span class="toolbar-spacer"></span>
      <button class="btn btn-ghost btn-sm" id="lib-pick" type="button">${icon('dice', 'sm')} o que assistir hoje</button>
      <button class="btn btn-ghost btn-sm" id="lib-layout" type="button" aria-pressed="false"></button>
      <button class="btn btn-ghost btn-sm" id="lib-select" type="button" aria-pressed="false">${icon('select', 'sm')} selecionar</button>
    </div>
    <div class="toolbar" id="lib-bulk" hidden>
      <span id="lib-count" role="status"></span>
      <button class="btn btn-ghost btn-sm" id="lib-all" type="button">todos</button>
      <select class="select input-pill" id="lib-status" aria-label="Mudar status dos selecionados">
        <option value="">mudar status…</option>
        ${TABS.filter((t) => t.value !== 'all').map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
      </select>
      <button class="btn btn-danger btn-sm" id="lib-remove" type="button" disabled>${icon('trash', 'sm')} remover da lista</button>
    </div>
    <div id="lib-list"><div class="grid">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div></div>
  `;

  const tabsEl = host.querySelector('#lib-tabs') as HTMLElement;
  const listEl = host.querySelector('#lib-list') as HTMLElement;
  const bulkEl = host.querySelector('#lib-bulk') as HTMLElement;
  const countEl = host.querySelector('#lib-count') as HTMLElement;
  const selectBtn = host.querySelector('#lib-select') as HTMLButtonElement;
  const layoutBtn = host.querySelector('#lib-layout') as HTMLButtonElement;
  const allBtn = host.querySelector('#lib-all') as HTMLButtonElement;
  const removeBtn = host.querySelector('#lib-remove') as HTMLButtonElement;
  const statusSel = host.querySelector('#lib-status') as HTMLSelectElement;

  const visible = (): LibraryItemDto[] => filterByStatus(filterBySource(items, source), status);

  const renderTabs = () => {
    const counts = countByStatus(filterBySource(items, source));
    tabsEl.innerHTML = TABS.map(
      (t) => `<button class="chip${status === t.value ? ' active' : ''}" type="button" data-value="${t.value}" aria-pressed="${status === t.value}">${t.label} <span class="count">${counts[t.value]}</span></button>`,
    ).join('');
  };

  const syncChrome = () => {
    const shown = visible();
    selectBtn.setAttribute('aria-pressed', String(selecting));
    selectBtn.innerHTML = selecting ? `${icon('x', 'sm')} cancelar seleção` : `${icon('select', 'sm')} selecionar`;
    // Rótulo fixo + aria-pressed: o estado é lido pelo leitor de tela, não pelo texto do botão.
    layoutBtn.innerHTML = `${icon('list', 'sm')} lista`;
    layoutBtn.setAttribute('aria-pressed', String(layout === 'list'));
    bulkEl.hidden = !selecting;
    countEl.textContent = `${picked.size} de ${shown.length} selecionado${picked.size === 1 ? '' : 's'}`;
    allBtn.textContent = shown.length > 0 && picked.size === shown.length ? 'nenhum' : 'todos';
    removeBtn.disabled = picked.size === 0;
    statusSel.disabled = picked.size === 0;
  };

  /** `focusIndex` devolve o foco ao card marcado — a grade é recriada e o teclado voltaria ao topo. */
  const renderList = (focusIndex?: number) => {
    // Sem nada visível não há o que selecionar: sai do modo lote em vez de ficar em "0 de 0 selecionados".
    if (visible().length === 0) {
      selecting = false;
      picked.clear();
    }
    renderTabs();
    syncChrome();
    const shown = visible();
    if (shown.length === 0) {
      listEl.innerHTML =
        items.length === 0
          ? `<div class="empty-state"><div class="big">${icon('inbox')}</div>sua biblioteca está vazia — <a href="#/search">busque algo</a> para adicionar</div>`
          : `<div class="empty-state"><div class="big">${icon('inbox')}</div>nada neste filtro<br><button class="btn btn-ghost btn-sm" id="lib-clear-filters" type="button">limpar filtros</button></div>`;
      return;
    }
    const grid = document.createElement('div');
    grid.className = layout === 'list' ? 'grid as-list' : 'grid';
    for (const [index, item] of shown.entries()) {
      grid.appendChild(
        renderCard({
          title: item.title.title,
          posterUrl: item.title.posterUrl,
          meta: metaFor(item),
          status: item.watchStatus,
          selection: selecting
            ? {
                selected: picked.has(item.titleId),
                onToggle: () => {
                  if (!picked.delete(item.titleId)) picked.add(item.titleId);
                  renderList(index);
                },
              }
            : undefined,
          onClick: () => navigate(libraryItemPath(item)),
        }),
      );
    }
    listEl.innerHTML = '';
    listEl.appendChild(grid);
    if (focusIndex !== undefined) (grid.children[focusIndex] as HTMLElement | undefined)?.focus();
  };

  const load = () => {
    listLibrary()
      .then((data) => {
        items = data.items;
        for (const id of picked) if (!items.some((i) => i.titleId === id)) picked.delete(id);
        renderList();
      })
      .catch(() => {
        listEl.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar sua biblioteca</div>`;
      });
  };

  // Delegação no contêiner: o botão de "limpar filtros" é recriado a cada render.
  listEl.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#lib-clear-filters')) return;
    status = 'all';
    source = 'all';
    (host.querySelector('#lib-source') as HTMLSelectElement).value = 'all';
    resetSelection();
    renderList();
  });

  /** Trocar filtro muda o que é "todos"; manter a seleção de itens fora da vista deixaria o lote agir no escuro. */
  const resetSelection = () => picked.clear();

  tabsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-value]');
    if (!btn) return;
    status = btn.dataset.value as StatusFilter;
    resetSelection();
    renderList();
  });

  (host.querySelector('#lib-source') as HTMLSelectElement).addEventListener('change', (e) => {
    source = (e.target as HTMLSelectElement).value as SourceFilter;
    resetSelection();
    renderList();
  });

  (host.querySelector('#lib-pick') as HTMLButtonElement).addEventListener('click', () => openPickDialog());

  layoutBtn.addEventListener('click', () => {
    layout = layout === 'grid' ? 'list' : 'grid';
    saveLayout(layout);
    renderList();
  });

  selectBtn.addEventListener('click', () => {
    selecting = !selecting;
    resetSelection();
    renderList();
  });

  allBtn.addEventListener('click', () => {
    const shown = visible();
    if (picked.size === shown.length) picked.clear();
    else for (const i of shown) picked.add(i.titleId);
    renderList();
  });

  const apply = (input: Parameters<typeof bulkLibrary>[0], doneMessage: (n: number) => string) => {
    removeBtn.disabled = true;
    statusSel.disabled = true;
    bulkLibrary(input)
      .then((res) => {
        showToast(doneMessage(res.affected));
        picked.clear();
        selecting = false;
        load();
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'falha ao aplicar a ação');
        syncChrome();
      });
  };

  statusSel.addEventListener('change', () => {
    const watchStatus = statusSel.value as WatchStatus | '';
    statusSel.value = '';
    if (!watchStatus || picked.size === 0) return;
    apply({ titleIds: [...picked], action: 'status', watchStatus }, (n) => `${n} item(ns) atualizado(s)`);
  });

  removeBtn.addEventListener('click', () => {
    if (!confirm(`Remover ${picked.size} item(ns) da biblioteca? Notas e status somem; o título continua disponível na busca.`)) return;
    apply({ titleIds: [...picked], action: 'remove' }, (n) => `${n} item(ns) removido(s)`);
  });

  load();
};
