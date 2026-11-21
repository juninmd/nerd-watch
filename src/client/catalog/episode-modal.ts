import { getTitleStreams, type TitleStreamsDto } from '../api/stremio.ts';
import type { StreamsQueryResolver } from '../addons/episode-streams.ts';
import { countStreamKinds, DEFAULT_STREAM_FILTER, filterTitleStreams, type StreamFilter, type StreamKind } from '../addons/stream-filter.ts';
import { mountStreams } from '../addons/title-streams-panel.ts';
import { currentRoute } from '../app/router.ts';
import { stopIfOnPageIn } from '../player/player-dock.ts';
import { releaseTorrentPlayers } from '../player/torrent-player.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { dateLabel } from './tvmaze-view.ts';
import { episodeCode, type EpisodeState, type EpisodeView } from './episode-browser-model.ts';

export interface EpisodeModalOptions {
  seriesTitle: string;
  /** Lista na ordem em que aparece na tela: ← e → andam por ela. */
  episodes: EpisodeView[];
  index: number;
  stateOf: (ep: EpisodeView) => EpisodeState;
  streams: (ep: EpisodeView) => ReturnType<StreamsQueryResolver>;
  /** Marca "visto até aqui"; devolve o novo estado para o botão. Ausente = série fora da sua lista. */
  onMark?: (ep: EpisodeView) => Promise<void>;
}

const KIND_LABEL: Record<StreamKind, string> = { all: 'Todos', p2p: 'P2P', direct: 'Direto', external: 'Externo' };
const QUALITY = [
  [0, 'Qualquer qualidade'],
  [720, '720p ou mais'],
  [1080, '1080p ou mais'],
  [2160, '4K'],
] as const;
const SORTS = [
  ['addon', 'Ordem do addon'],
  ['seeds', 'Mais seeds'],
  ['quality', 'Melhor qualidade'],
] as const;

const metaHtml = (ep: EpisodeView): string =>
  [ep.rating ? `<span>★ ${ep.rating.toFixed(1)}</span>` : '', ep.runtime ? `<span>${ep.runtime} min</span>` : '', `<span>${escapeHtml(ep.airDate ? dateLabel(ep.airDate) : 'data a confirmar')}</span>`]
    .filter(Boolean)
    .join('<span class="ep-dot" aria-hidden="true"></span>');

/** Detalhe do episódio em diálogo nativo: sinopse, marcar como visto e links dos addons com filtros. */
export const openEpisodeModal = (opts: EpisodeModalOptions): void => {
  document.querySelector('dialog.ep-modal')?.remove();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const d = document.createElement('dialog');
  d.className = 'dialog ep-modal';
  d.setAttribute('closedby', 'any');
  d.setAttribute('aria-labelledby', 'ep-modal-title');
  document.body.appendChild(d);
  let index = opts.index;
  let filter: StreamFilter = { ...DEFAULT_STREAM_FILTER };
  let dto: TitleStreamsDto | null = null;
  let seq = 0;

  const cleanup = () => {
    stopIfOnPageIn(d);
    releaseTorrentPlayers(d);
  };

  const drawStreams = () => {
    const slot = d.querySelector<HTMLElement>('#ep-streams');
    const tools = d.querySelector<HTMLElement>('#ep-stream-tools');
    const kinds = tools?.querySelector<HTMLElement>('[data-kinds]');
    if (!slot || !tools || !kinds || !dto) return;
    // Trocar o filtro remonta a lista: encerra antes o player/torrent que estava tocando nela.
    cleanup();
    const counts = countStreamKinds(dto);
    tools.hidden = counts.all === 0;
    kinds.innerHTML = (Object.keys(KIND_LABEL) as StreamKind[])
      .filter((k) => k === 'all' || counts[k] > 0)
      .map((k) => `<button type="button" class="chip${filter.kind === k ? ' active' : ''}" data-kind="${k}" aria-pressed="${filter.kind === k}">${KIND_LABEL[k]} <span class="dim">${counts[k]}</span></button>`)
      .join('');
    const ep = opts.episodes[index] as EpisodeView;
    const q = opts.streams(ep);
    mountStreams(slot, filterTitleStreams(dto, filter), {
      title: `${opts.seriesTitle} · ${episodeCode(ep)}`,
      posterUrl: null,
      route: currentRoute().path,
      // Mesma busca de legendas que a linha de episódio antiga fazia.
      captions:
        'unavailable' in q
          ? null
          : { query: ep.name ?? opts.seriesTitle, ...(q.tmdbId ? { tmdbId: q.tmdbId } : {}), mediaType: q.mediaType, season: q.season ?? null, episode: q.episode ?? null },
    });
  };

  const loadStreams = (ep: EpisodeView) => {
    const slot = d.querySelector<HTMLElement>('#ep-streams') as HTMLElement;
    const q = opts.streams(ep);
    if ('unavailable' in q) {
      slot.innerHTML = `<p class="hint">${escapeHtml(q.unavailable)}</p>`;
      return;
    }
    const mine = ++seq;
    slot.setAttribute('aria-busy', 'true');
    slot.innerHTML = '<div class="skeleton" style="height:56px"></div><div class="skeleton" style="height:56px;margin-top:8px"></div>';
    getTitleStreams(q)
      .then((res) => {
        if (mine !== seq || !d.isConnected) return;
        dto = res;
        if (!res.addons.length) {
          slot.innerHTML = '<p class="hint">Instale um addon de streams em <a href="#/addons">Addons</a> para ver links aqui.</p>';
          return;
        }
        drawStreams();
      })
      .catch(() => {
        if (mine === seq) slot.innerHTML = '<p class="hint" role="alert">não foi possível consultar os addons agora.</p>';
      })
      .finally(() => {
        if (mine === seq) slot.removeAttribute('aria-busy');
      });
  };

  const render = () => {
    cleanup();
    dto = null;
    const ep = opts.episodes[index] as EpisodeView;
    const state = opts.stateOf(ep);
    const first = index === 0;
    const last = index === opts.episodes.length - 1;
    d.innerHTML = `
      <div class="ep-modal-head">
        <div class="ep-modal-still"${ep.stillUrl ? '' : ' data-empty'} data-n="${ep.number}"></div>
        <div class="ep-modal-tools">
          <button type="button" class="btn btn-ghost btn-sm" data-step="-1" aria-label="Episódio anterior"${first ? ' disabled' : ''}>${icon('back', 'sm')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-step="1" aria-label="Próximo episódio"${last ? ' disabled' : ''}>${icon('forward', 'sm')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Fechar">${icon('x', 'sm')}</button>
        </div>
        <div class="ep-modal-title">
          <span class="eyebrow">${escapeHtml(opts.seriesTitle)} · ${escapeHtml(episodeCode(ep))}</span>
          <h2 id="ep-modal-title">${escapeHtml(ep.name)}</h2>
          <div class="ep-meta">${metaHtml(ep)}</div>
        </div>
      </div>
      <div class="ep-modal-body">
        <p class="ep-modal-overview">${escapeHtml(ep.overview || 'Sem sinopse disponível.')}</p>
        <div class="ep-modal-actions">
          ${
            opts.onMark
              ? state === 'current'
                ? `<span class="tvm-chip">${icon('check', 'sm')} é onde você parou</span>`
                : `<button type="button" class="btn ${state === 'watched' ? 'btn-ghost' : 'btn-primary'} btn-sm" data-mark>${icon('check', 'sm')} ${state === 'watched' ? 'Voltar o marcador para cá' : 'Marcar visto até aqui'}</button>`
              : '<span class="hint">Adicione a série à sua lista para marcar episódios.</span>'
          }
          <span class="hint ep-keys"><kbd>←</kbd> <kbd>→</kbd> trocam de episódio${opts.onMark ? ', <kbd>w</kbd> marca como visto' : ''}</span>
        </div>
        <section aria-labelledby="ep-where">
          <h3 id="ep-where">Onde assistir</h3>
          <div class="ep-stream-tools" id="ep-stream-tools" hidden>
            <div class="chip-row" role="group" aria-label="Tipo de link" data-kinds></div>
            <label class="sr-only" for="ep-quality">Qualidade mínima</label>
            <select id="ep-quality" class="input input-sm">${QUALITY.map(([v, l]) => `<option value="${v}"${filter.minHeight === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
            <label class="sr-only" for="ep-sort">Ordenar links</label>
            <select id="ep-sort" class="input input-sm">${SORTS.map(([v, l]) => `<option value="${v}"${filter.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          <div id="ep-streams"></div>
        </section>
      </div>`;
    // Via CSSOM: a URL nunca é parseada como marcação.
    if (ep.stillUrl) (d.querySelector('.ep-modal-still') as HTMLElement).style.backgroundImage = `url("${ep.stillUrl}")`;
    loadStreams(ep);
  };

  const step = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= opts.episodes.length) return;
    index = next;
    render();
    // render() troca o DOM inteiro: sem refoco, o foco cai no body e as teclas do modal param.
    (d.querySelector<HTMLElement>(`[data-step="${delta}"]:not([disabled])`) ?? d.querySelector<HTMLElement>('[data-close]'))?.focus();
  };

  const mark = () => {
    const btn = d.querySelector<HTMLButtonElement>('[data-mark]');
    if (!btn || btn.disabled || !opts.onMark) return;
    btn.disabled = true;
    opts
      .onMark(opts.episodes[index] as EpisodeView)
      .then(() => {
        if (!d.isConnected) return;
        render();
        (d.querySelector<HTMLElement>('[data-mark]:not([disabled])') ?? d.querySelector<HTMLElement>('[data-close]'))?.focus();
      })
      .catch(() => {
        btn.disabled = false;
      });
  };

  d.addEventListener('click', (e) => {
    if (e.target === d) return d.close();
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.step) step(Number(t.dataset.step));
    else if ('close' in t.dataset) d.close();
    else if ('mark' in t.dataset) mark();
    else if (t.dataset.kind) {
      filter = { ...filter, kind: t.dataset.kind as StreamKind };
      drawStreams();
      d.querySelector<HTMLElement>(`[data-kind="${filter.kind}"]`)?.focus();
    }
  });
  d.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.id === 'ep-quality') filter = { ...filter, minHeight: Number(t.value) };
    else if (t.id === 'ep-sort') filter = { ...filter, sort: t.value as StreamFilter['sort'] };
    else return;
    drawStreams();
  });
  d.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    // Com vídeo aberto no modal, as setas são do player (avançar/voltar), não da troca de episódio.
    if (typing || e.altKey || e.ctrlKey || e.metaKey || d.querySelector('video, iframe')) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key.toLowerCase() === 'w') mark();
    else return;
    e.preventDefault();
  });
  d.addEventListener('close', () => {
    cleanup();
    d.remove();
    if (opener?.isConnected) opener.focus();
  });

  render();
  d.showModal();
  d.querySelector<HTMLElement>('[data-close]')?.focus();
};
