import type { EpisodeMarker } from '../library/episode-progress.ts';
import type { StreamsQueryResolver } from '../addons/episode-streams.ts';
import { escapeHtml, posterCssUrl } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { dateLabel } from './tvmaze-view.ts';
import { openEpisodeModal } from './episode-modal.ts';
import { episodeCode, episodeState, type EpisodeFilter, type EpisodeLayout, type EpisodeSort, type EpisodeView, filterEpisodes } from './episode-browser-model.ts';

export interface EpisodeBrowserOptions {
  seriesTitle: string;
  seasons: Array<{ number: number; name: string; count: number }>;
  initialSeason: number;
  /** Carrega uma temporada (TMDB busca sob demanda; TVmaze já tem tudo). */
  load: (season: number) => Promise<EpisodeView[]>;
  marker: () => EpisodeMarker | null;
  streams: (ep: EpisodeView) => ReturnType<StreamsQueryResolver>;
  onMark?: (ep: EpisodeView) => Promise<void>;
  playPath?: (ep: EpisodeView) => string;
  /** Linha extra sob as abas (estreia, final, emissora da temporada). */
  seasonNote?: (season: number) => string;
}

export interface EpisodeBrowser {
  selectSeason: (season: number) => void;
  /** Repinta com o marcador atual (depois de marcar um episódio). */
  refresh: () => void;
  /** Recarrega a temporada aberta (ex.: chegaram notas por episódio). */
  reload: () => void;
}

const LAYOUT_KEY = 'nw.episodes.layout';
const SORTS: Array<[EpisodeSort, string]> = [
  ['number', 'Ordem de exibição'],
  ['rating', 'Maior nota'],
  ['recent', 'Mais recentes primeiro'],
];

const loadLayout = (): EpisodeLayout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};
const saveLayout = (v: EpisodeLayout): void => {
  try {
    localStorage.setItem(LAYOUT_KEY, v);
  } catch {
    // Preferência só deste navegador: sem armazenamento, vale até recarregar.
  }
};

const cardHtml = (ep: EpisodeView, state: ReturnType<typeof episodeState>, canMark: boolean): string => {
  const label = `${episodeCode(ep)}, ${ep.name}${state === 'watched' ? ', visto' : state === 'current' ? ', onde você parou' : ''}`;
  const meta = [ep.tag ? `<span class="tvm-chip">${escapeHtml(ep.tag)}</span>` : '', ep.rating ? `<span class="ep-rate">★ ${ep.rating.toFixed(1)}</span>` : '', ep.runtime ? `<span>${ep.runtime} min</span>` : '', `<span>${escapeHtml(ep.airDate ? dateLabel(ep.airDate) : 'data a confirmar')}</span>`].join('');
  return `<article class="ep-card is-${state}">
    <div class="ep-still"${ep.stillUrl ? ` data-still="${escapeHtml(ep.stillUrl)}"` : ''} data-n="${ep.number}" aria-hidden="true"><span class="ep-play">${icon('play', 'sm')}</span></div>
    <div class="ep-info">
      <span class="ep-code">${escapeHtml(episodeCode(ep))}${state === 'current' ? ' · onde parou' : ''}</span>
      <h3>${escapeHtml(ep.name)}</h3>
      <div class="ep-meta">${meta}</div>
      ${ep.overview ? `<p>${escapeHtml(ep.overview)}</p>` : ''}
    </div>
    <button type="button" class="ep-open" data-open="${ep.number}" aria-label="${escapeHtml(label)}: detalhes e onde assistir"></button>
    ${canMark && state !== 'current' ? `<button type="button" class="ep-seen" data-mark="${ep.number}" aria-pressed="${state === 'watched'}" aria-label="${state === 'watched' ? 'Voltar o marcador para' : 'Marcar visto até'} ${escapeHtml(episodeCode(ep))}">${icon('check', 'sm')}</button>` : ''}
  </article>`;
};

/** Episódios com abas de temporada, busca, ordem, "só não vistos" e grade/lista. Clique abre o modal do episódio. */
export const renderEpisodeBrowser = (host: HTMLElement, opts: EpisodeBrowserOptions): EpisodeBrowser => {
  const real = opts.seasons.filter((s) => s.count > 0);
  let season = real.some((s) => s.number === opts.initialSeason) ? opts.initialSeason : (real[0]?.number ?? 1);
  let layout = loadLayout();
  const filter: EpisodeFilter = { query: '', onlyUnseen: false, sort: 'number' };
  let episodes: EpisodeView[] = [];
  let shown: EpisodeView[] = [];
  let seq = 0;

  if (real.length === 0) {
    host.innerHTML = `<div class="empty-state"><div class="big">${icon('inbox')}</div>sem episódios listados</div>`;
    return { selectSeason: () => undefined, refresh: () => undefined, reload: () => undefined };
  }

  host.innerHTML = `
    <div class="section-head ep-head"><h2>Episódios</h2><span class="hint" id="ep-season-note"></span></div>
    <div class="season-tabs" role="group" aria-label="Temporadas" id="ep-tabs"></div>
    <div class="ep-toolbar">
      <label class="sr-only" for="ep-q">Buscar episódio</label>
      <input id="ep-q" class="input input-sm" type="search" placeholder="Buscar episódio" autocomplete="off" />
      <label class="sr-only" for="ep-order">Ordenar episódios</label>
      <select id="ep-order" class="input input-sm">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button type="button" class="chip" id="ep-unseen" aria-pressed="false">Só não vistos</button>
      <div class="ep-seg" role="group" aria-label="Visualização dos episódios">
        <button type="button" data-layout="grid" aria-pressed="${layout === 'grid'}">${icon('grid', 'sm')} Grade</button>
        <button type="button" data-layout="list" aria-pressed="${layout === 'list'}">${icon('list', 'sm')} Lista</button>
      </div>
    </div>
    <div id="ep-out" class="ep-grid"></div>`;
  const tabs = host.querySelector('#ep-tabs') as HTMLElement;
  const out = host.querySelector('#ep-out') as HTMLElement;

  const drawTabs = () => {
    tabs.innerHTML = real
      .map((s) => `<button type="button" class="chip${s.number === season ? ' active' : ''}" data-season="${s.number}" aria-pressed="${s.number === season}">${escapeHtml(s.name)} <span class="dim">${s.count}</span></button>`)
      .join('');
    (host.querySelector('#ep-season-note') as HTMLElement).textContent = opts.seasonNote?.(season) ?? '';
  };

  const draw = () => {
    const marker = opts.marker();
    shown = filterEpisodes(episodes, filter, marker);
    out.className = layout === 'list' ? 'ep-list' : 'ep-grid';
    if (shown.length === 0) {
      out.innerHTML = `<div class="empty-state">${episodes.length ? 'nenhum episódio com esses filtros' : 'sem episódios listados para esta temporada'}</div>`;
      return;
    }
    out.innerHTML = shown.map((ep) => cardHtml(ep, episodeState(marker, ep), Boolean(opts.onMark))).join('');
    // Via CSSOM + posterCssUrl: escapa aspas/barras e a URL da imagem nunca vira marcação.
    for (const el of out.querySelectorAll<HTMLElement>('[data-still]')) {
      if (el.dataset.still) el.style.backgroundImage = posterCssUrl(el.dataset.still);
    }
  };

  const loadSeason = () => {
    const mine = ++seq;
    out.setAttribute('aria-busy', 'true');
    out.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:180px"></div>').join('');
    opts
      .load(season)
      .then((eps) => {
        if (mine !== seq || !out.isConnected) return;
        episodes = eps;
        draw();
      })
      .catch(() => {
        if (mine === seq && out.isConnected) out.innerHTML = `<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>não foi possível carregar os episódios</div>`;
      })
      .finally(() => {
        if (mine === seq && out.isConnected) out.removeAttribute('aria-busy');
      });
  };

  const selectSeason = (n: number) => {
    if (!real.some((s) => s.number === n)) return;
    season = n;
    drawTabs();
    loadSeason();
  };

  host.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t || !host.contains(t)) return;
    if (t.dataset.season) {
      selectSeason(Number(t.dataset.season));
      // As abas são recriadas: devolve o foco para quem usa teclado não perder a posição.
      tabs.querySelector<HTMLElement>('.chip.active')?.focus();
    } else if (t.dataset.layout) {
      layout = t.dataset.layout === 'list' ? 'list' : 'grid';
      saveLayout(layout);
      for (const b of host.querySelectorAll<HTMLElement>('[data-layout]')) b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
      draw();
    } else if (t.id === 'ep-unseen') {
      filter.onlyUnseen = !filter.onlyUnseen;
      t.setAttribute('aria-pressed', String(filter.onlyUnseen));
      t.classList.toggle('active', filter.onlyUnseen);
      draw();
    } else if (t.dataset.open) {
      const i = shown.findIndex((ep) => ep.number === Number(t.dataset.open));
      if (i < 0) return;
      openEpisodeModal({
        seriesTitle: opts.seriesTitle,
        episodes: shown,
        index: i,
        stateOf: (ep) => episodeState(opts.marker(), ep),
        streams: opts.streams,
        onMark: opts.onMark,
        playPath: opts.playPath,
      });
    } else if (t.dataset.mark && opts.onMark) {
      const ep = episodes.find((x) => x.number === Number(t.dataset.mark));
      if (!ep) return;
      t.disabled = true;
      opts.onMark(ep).catch(() => {
        if (t.isConnected) t.disabled = false;
      });
    }
  });
  (host.querySelector('#ep-q') as HTMLInputElement).addEventListener('input', (e) => {
    filter.query = (e.target as HTMLInputElement).value;
    draw();
  });
  (host.querySelector('#ep-order') as HTMLSelectElement).addEventListener('change', (e) => {
    filter.sort = (e.target as HTMLSelectElement).value as EpisodeSort;
    draw();
  });

  drawTabs();
  loadSeason();
  return {
    selectSeason,
    refresh: draw,
    reload: () => {
      drawTabs();
      loadSeason();
    },
  };
};
