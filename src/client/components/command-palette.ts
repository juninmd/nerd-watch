import { listLibrary, listTelegramChannels } from '../api.ts';
import { listSavedViews } from '../views-api.ts';
import { icon } from '../icons.ts';
import { filterEntries, type PaletteEntry } from '../palette-search.ts';
import { openPickDialog } from './pick-dialog.ts';
import { navigate } from '../router.ts';
import { handleLabel } from '../source-modes.ts';
import { libraryItemPath } from '../title-link.ts';
import { escapeHtml } from './card.ts';

const STATUS_LABEL: Record<string, string> = { want: 'quero ver', watching: 'assistindo', watched: 'assistido', dropped: 'abandonado' };
const GROUP_ICON = { Títulos: 'film', Canais: 'send', Ações: 'sliders', Catálogo: 'search' } as const;

/** Ações fixas: navegação e atalhos. Os mesmos atalhos "g + letra" são registrados em `shortcuts.ts`. */
const staticActions = (): PaletteEntry[] => [
  { id: 'go-home', group: 'Ações', title: 'Ir para o Início', keys: 'g h', run: () => navigate('/') },
  { id: 'go-library', group: 'Ações', title: 'Ir para a Biblioteca', keys: 'g b', run: () => navigate('/library') },
  { id: 'go-telegram', group: 'Ações', title: 'Ir para o Telegram', keys: 'g t', run: () => navigate('/telegram') },
  { id: 'go-lists', group: 'Ações', title: 'Ir para as Listas', run: () => navigate('/lists') },
  { id: 'go-agenda', group: 'Ações', title: 'Ir para a Agenda', keys: 'g a', run: () => navigate('/agenda') },
  { id: 'go-stats', group: 'Ações', title: 'Ir para as Estatísticas', keys: 'g e', run: () => navigate('/estatisticas') },
  { id: 'go-connections', group: 'Ações', title: 'Ir para as Conexões', keys: 'g c', run: () => navigate('/connections') },
  { id: 'go-pd', group: 'Ações', title: 'Explorar o domínio público', run: () => navigate('/public-domain') },
  { id: 'pick', group: 'Ações', title: 'O que assistir hoje (sorteio)', run: () => openPickDialog() },
  { id: 'telegram-import', group: 'Ações', title: 'Importar meus canais do Telegram', run: () => navigate('/telegram?import=1') },
  { id: 'backup', group: 'Ações', title: 'Exportar ou importar backup', run: () => navigate('/connections?focus=backup') },
];

let dataPromise: Promise<PaletteEntry[]> | null = null;
let loadedAt = 0;
const TTL_MS = 30_000;

/** Biblioteca e canais mudam pouco entre aberturas da paleta: reaproveita por 30s em vez de refazer 2 requests a cada Ctrl+K. */
const loadDataEntries = (): Promise<PaletteEntry[]> => {
  if (dataPromise && Date.now() - loadedAt < TTL_MS) return dataPromise;
  loadedAt = Date.now();
  dataPromise = Promise.allSettled([listLibrary(), listTelegramChannels(), listSavedViews()]).then(([lib, ch, sv]) => {
    // Visões salvas viram ações: Ctrl K + nome aplica a visão na biblioteca de uma vez.
    const views: PaletteEntry[] =
      sv.status === 'fulfilled'
        ? sv.value.items.map((v) => ({
            id: `view:${v.id}`,
            group: 'Ações',
            title: `Visão: ${v.name}`,
            sub: 'biblioteca',
            run: () => navigate(`/library?view=${encodeURIComponent(v.id)}`),
          }))
        : [];
    const titles: PaletteEntry[] =
      lib.status === 'fulfilled'
        ? lib.value.items.map((it) => ({
            id: `title:${it.id}`,
            group: 'Títulos',
            title: it.title.title,
            sub: [it.title.releaseDate?.slice(0, 4), STATUS_LABEL[it.watchStatus]].filter(Boolean).join(' · '),
            run: () => navigate(libraryItemPath(it)),
          }))
        : [];
    const channels: PaletteEntry[] =
      ch.status === 'fulfilled'
        ? ch.value.channels.map((c) => ({
            id: `channel:${c.titleId}`,
            group: 'Canais',
            title: handleLabel(c.handle, c.title),
            sub: `${c.itemCount} vídeo${c.itemCount === 1 ? '' : 's'}`,
            run: () => navigate(`/telegram/${c.titleId}`),
          }))
        : [];
    return [...titles, ...channels, ...views];
  });
  return dataPromise;
};

/** Invalida o cache (ex.: depois de importar canais ou mudar a biblioteca). */
export const invalidatePaletteData = (): void => {
  dataPromise = null;
};

let dialog: HTMLDialogElement | null = null;

export const openCommandPalette = (): void => {
  if (dialog?.open) return;
  dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Paleta de comandos');
  dialog.innerHTML = `
    <div class="pal-in">${icon('search')}
      <input id="pal-input" type="text" placeholder="Buscar títulos, canais e ações…" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-label="Buscar" />
      <kbd>Esc</kbd></div>
    <div id="pal-list" class="pal-list" role="listbox" aria-label="Resultados"></div>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span></div>`;
  // Quem abriu (botão, atalho, link) recebe o foco de volta ao fechar; sem isso o foco cai no <body>.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(dialog);
  const d = dialog;
  d.addEventListener('close', () => {
    d.remove();
    if (opener?.isConnected) opener.focus();
  });
  // Fallback para navegadores sem `closedby="any"`: clique no backdrop fecha.
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  d.showModal();

  const input = d.querySelector('#pal-input') as HTMLInputElement;
  const list = d.querySelector('#pal-list') as HTMLElement;
  let data: PaletteEntry[] = [];
  let shown: PaletteEntry[] = [];
  let index = 0;

  const catalogEntry = (q: string): PaletteEntry => ({
    id: 'catalog',
    group: 'Catálogo',
    title: `Buscar “${q}” no catálogo`,
    sub: 'filmes, séries e novelas',
    run: () => navigate(`/search?q=${encodeURIComponent(q)}`),
  });

  const draw = () => {
    const q = input.value.trim();
    shown = filterEntries([...data, ...staticActions(), ...(q ? [catalogEntry(q)] : [])], q);
    index = Math.min(index, Math.max(0, shown.length - 1));
    let lastGroup = '';
    list.innerHTML = shown
      .map((e, i) => {
        const head = e.group !== lastGroup ? `<div class="pal-group" role="presentation">${e.group}</div>` : '';
        lastGroup = e.group;
        return `${head}<div class="pal-opt" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === index}">
          <span class="pal-ic" aria-hidden="true">${icon(GROUP_ICON[e.group])}</span>
          <span class="pal-txt"><b>${escapeHtml(e.title)}</b>${e.sub ? `<small>${escapeHtml(e.sub)}</small>` : ''}</span>
          ${e.keys ? `<kbd>${escapeHtml(e.keys)}</kbd>` : ''}</div>`;
      })
      .join('');
    if (shown.length === 0) list.innerHTML = '<p class="pal-empty">Nada encontrado. Tente outro termo.</p>';
    input.setAttribute('aria-activedescendant', shown.length ? `pal-${index}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i: number) => {
    const entry = shown[i];
    if (!entry) return;
    d.close();
    entry.run();
  };

  input.addEventListener('input', () => {
    index = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length === 0) return;
      index = (index + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(index);
    }
  });
  list.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (opt) choose(Number(opt.dataset.i));
  });
  list.addEventListener('pointermove', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (opt && Number(opt.dataset.i) !== index) {
      index = Number(opt.dataset.i);
      for (const el of list.querySelectorAll('[aria-selected="true"]')) el.setAttribute('aria-selected', 'false');
      opt.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', `pal-${index}`);
    }
  });

  draw();
  input.focus();
  void loadDataEntries().then((entries) => {
    if (!d.isConnected) return;
    data = entries;
    draw();
  });
};
