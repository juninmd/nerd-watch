import { type AddonDto, type AddonItemDto, getAddonCatalog, listAddons } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { escapeHtml, posterStyleAttr, renderCard } from '../ui/card.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { icon } from '../ui/icons.ts';
import { addonItemPath } from './addon-links.ts';

const SKELETON = `<div class="grid">${Array.from({ length: 12 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div>`;

/** Catálogo de um addon instalado: escolhe o catálogo, busca (se o addon aceitar) e pagina com `skip`. */
export const renderAddonBrowse = (host: HTMLElement, addonId: string): void => {
  const root = document.createElement('div');
  host.replaceChildren(root);
  root.innerHTML = `${backButtonHtml('addons')}<div class="skeleton" style="height:120px;border-radius:20px"></div>`;
  wireBackButton(root, '/addons');

  listAddons()
    .then((addons) => {
      if (!root.isConnected) return;
      const addon = addons.find((a) => a.id === addonId);
      if (!addon || addon.catalogs.length === 0) throw new Error('addon sem catálogo');
      paint(root, addon);
    })
    .catch(() => {
      if (!root.isConnected) return;
      root.innerHTML = `${backButtonHtml('addons')}<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>addon não encontrado ou sem catálogo</div>`;
      wireBackButton(root, '/addons');
    });
};

const paint = (host: HTMLElement, addon: AddonDto): void => {
  host.innerHTML = `
    <header class="view-head addon-hero">
      ${addon.background ? `<div class="addon-hero-bg" aria-hidden="true"${posterStyleAttr(addon.background)}></div>` : ''}
      ${backButtonHtml('addons')}
      <h1 class="view-title">${escapeHtml(addon.name)}</h1>
      <p class="view-subtitle">${escapeHtml(addon.host)}</p>
    </header>
    <div class="chip-row form-row">
      <select id="ab-catalog" class="select input-pill" aria-label="catálogo">
        ${addon.catalogs.map((c, i) => `<option value="${i}">${escapeHtml(c.name)} (${escapeHtml(c.type)})</option>`).join('')}
      </select>
      <input type="search" id="ab-search" class="input input-pill grow" placeholder="buscar neste catálogo" autocomplete="off" aria-label="buscar neste catálogo" />
    </div>
    <div class="chip-row" id="ab-genres" aria-label="filtrar por gênero"></div>
    <div id="ab-grid">${SKELETON}</div>
    <div class="chip-row" id="ab-more-row" hidden><button type="button" class="btn btn-ghost btn-sm" id="ab-more">carregar mais</button></div>
  `;
  wireBackButton(host, '/addons');

  const select = host.querySelector('#ab-catalog') as HTMLSelectElement;
  const search = host.querySelector('#ab-search') as HTMLInputElement;
  const genresEl = host.querySelector('#ab-genres') as HTMLElement;
  const grid = host.querySelector('#ab-grid') as HTMLElement;
  const moreRow = host.querySelector('#ab-more-row') as HTMLElement;
  const more = host.querySelector('#ab-more') as HTMLButtonElement;

  let shown = 0;
  let seq = 0;
  /** Gênero escolhido; `null` = todos. Sempre pertence ao catálogo atual. */
  let genre: string | null = null;

  const catalog = () => addon.catalogs[Number(select.value)] ?? addon.catalogs[0];

  /** Chips só com os gêneros que o próprio catálogo declara: gênero inventado voltaria vazio. */
  const paintGenres = () => {
    const cat = catalog();
    const genres = cat?.genres ?? [];
    genresEl.innerHTML = genres.length
      ? [null, ...genres]
          .map((g) => `<button type="button" class="chip${g === genre ? ' active' : ''}" data-genre="${g === null ? '' : escapeHtml(g)}" aria-pressed="${g === genre}">${g === null ? 'todos' : escapeHtml(g)}</button>`)
          .join('')
      : '';
    genresEl.hidden = genres.length === 0;
  };

  const append = (items: AddonItemDto[], reset: boolean) => {
    if (reset) {
      grid.innerHTML = '';
      if (items.length === 0) {
        grid.innerHTML = `<div class="empty-state"><div class="big">🕵️</div>nada encontrado neste catálogo</div>`;
        return;
      }
      const g = document.createElement('div');
      g.className = 'grid';
      grid.appendChild(g);
    }
    const g = grid.querySelector('.grid');
    for (const item of items) {
      g?.appendChild(renderCard({ title: item.name, posterUrl: item.poster, meta: item.year ?? undefined, onClick: () => navigate(addonItemPath(addon.id, item.type, item.id)) }));
    }
  };

  const load = (reset: boolean) => {
    const cat = catalog();
    if (!cat) return;
    const mine = ++seq;
    if (reset) {
      shown = 0;
      grid.innerHTML = SKELETON;
    }
    const q = search.value.trim();
    search.disabled = !cat.searchable;
    search.placeholder = cat.searchable ? 'buscar neste catálogo' : 'este catálogo não aceita busca';
    more.disabled = true;
    getAddonCatalog(addon.id, cat.type, cat.id, { search: cat.searchable ? q : undefined, skip: shown || undefined, genre: genre ?? undefined })
      .then((items) => {
        if (mine !== seq || !grid.isConnected) return;
        append(items, reset);
        shown += items.length;
        moreRow.hidden = !(cat.paged && items.length > 0);
        more.disabled = false;
      })
      .catch((error: Error) => {
        if (mine !== seq || !grid.isConnected) return;
        if (reset) grid.innerHTML = `<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>${escapeHtml(error.message)}</div>`;
        moreRow.hidden = true;
      });
  };

  let debounce: ReturnType<typeof setTimeout>;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (search.isConnected) load(true);
    }, 350);
  });
  genresEl.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-genre]');
    if (!button) return;
    genre = button.dataset.genre || null;
    paintGenres();
    load(true);
  });
  select.addEventListener('change', () => {
    search.value = '';
    genre = null;
    paintGenres();
    load(true);
  });
  more.addEventListener('click', () => load(false));
  paintGenres();
  load(true);
};
