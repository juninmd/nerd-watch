import { getTitleStreams, type TitleStreamsDto } from '../api/stremio.ts';
import { streamFacts } from '../addons/stream-filter.ts';
import { findAddonStream } from '../addons/stream-lookup.ts';
import { mountStreams } from '../addons/title-streams-panel.ts';
import { navigate } from '../app/router.ts';
import { episodeCode, type EpisodeView } from '../catalog/episode-browser-model.ts';
import { dateLabel } from '../catalog/tvmaze-view.ts';
import { isEpisodeWatched } from '../library/episode-progress.ts';
import { markThrough } from '../library/mark-progress.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { hdStill, isPlayable, neighborEpisode, type PlaySource, playPath, pickStream, type StreamPick, type StreamPref } from './episode-play-model.ts';
import { loadPlayContext, type PlayContext } from './play-context.ts';
import { getAutoplay, getVideo, setAutoplay, subscribeEnded } from './player-dock.ts';

const PREF_KEY = 'nw.play.pref';
/** Desmonta a tela anterior na hora (listeners, contagem) quando outro episódio abre por cima. */
let disposeCurrent: (() => void) | null = null;
const COUNTDOWN = 10;

const readPref = (): StreamPref | null => {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as StreamPref | null;
    return v && typeof v.addonId === 'string' && Number.isFinite(v.height) ? v : null;
  } catch {
    return null;
  }
};
const savePref = (p: StreamPref): void => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Sem storage (modo privado): só não lembra a fonte no próximo episódio.
  }
};

const queueRow = (ctx: PlayContext, ep: EpisodeView, current: EpisodeView, marker: PlayContext['marker']): string => {
  const now = ep.season === current.season && ep.number === current.number;
  const seen = isEpisodeWatched(marker, ep.season, ep.number);
  const status = now ? 'tocando agora' : seen ? 'visto' : ep.runtime ? `${ep.runtime} min` : '';
  return `<a class="next-item play-q${seen && !now ? ' is-seen' : ''}" href="#${playPath(ctx.source, ctx.id, ep.season, ep.number)}"${now ? ' aria-current="true"' : ''}>
    <span class="next-thumb">${ep.stillUrl ? `<img class="next-thumb-img" src="${escapeHtml(ep.stillUrl)}" alt="" loading="lazy" decoding="async" />` : icon('film')}${now ? '<small class="play-now">tocando</small>' : ''}</span>
    <span class="next-text"><small class="mono">${episodeCode(ep)}</small><b>${escapeHtml(ep.name)}</b><small>${escapeHtml(status)}</small></span>
  </a>`;
};

const render = (root: HTMLElement, ctx: PlayContext, list: EpisodeView[], ep: EpisodeView, explicit: StreamPick | null): void => {
  let marker = ctx.marker;
  const numbers = list.map((e) => e.number);
  const prev = neighborEpisode(ctx.seasons, ep.season, ep.number, -1, numbers);
  const next = neighborEpisode(ctx.seasons, ep.season, ep.number, 1, numbers);
  const hd = hdStill(ep.stillUrl);
  const go = (to: { season: number; episode: number } | null) => to && navigate(playPath(ctx.source, ctx.id, to.season, to.episode));
  document.title = `${ctx.seriesTitle} ${episodeCode(ep)} — nerd-watch`;

  root.innerHTML = `
    <div class="watch play">
      <div class="watch-main">
        <div class="play-frame">
          <div class="play-host" id="play-host">${hd ? `<img class="play-poster" src="${escapeHtml(hd)}" alt="" />` : ''}<p class="play-status" id="play-status" role="status">Procurando fontes…</p></div>
          <div class="watch-end" id="play-end" hidden></div>
        </div>
        <a class="btn btn-ghost btn-sm watch-back" href="${ctx.backHref}">${icon('back', 'sm')} ${escapeHtml(ctx.seriesTitle)}</a>
        <p class="eyebrow">${escapeHtml(ctx.seriesTitle)} · ${episodeCode(ep)}</p>
        <h1 class="watch-title">${escapeHtml(ep.name)}</h1>
        <p class="hint">${[ep.runtime ? `${ep.runtime} min` : '', ep.airDate ? dateLabel(ep.airDate) : ''].filter(Boolean).join(' · ')}</p>
        <div class="watch-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-step="-1"${prev ? '' : ' disabled'}>${icon('back', 'sm')} Anterior</button>
          <button class="btn btn-primary btn-sm" type="button" data-mark>Marcar visto até aqui</button>
          <button class="btn btn-ghost btn-sm" type="button" data-step="1"${next ? '' : ' disabled'}>Próximo ${icon('forward', 'sm')}</button>
          <label class="switch"><input type="checkbox" id="play-auto"${getAutoplay() ? ' checked' : ''} /> próximo episódio automático</label>
        </div>
        ${ep.overview ? `<p class="watch-desc">${escapeHtml(ep.overview)}</p>` : ''}
        <p class="hint"><kbd>Shift</kbd>+<kbd>N</kbd> próximo · <kbd>Shift</kbd>+<kbd>P</kbd> anterior · demais teclas do player como no YouTube</p>
      </div>
      <aside class="watch-next play-side" aria-label="Episódios e fontes">
        <div class="chip-row" role="tablist" aria-label="Painel lateral">
          <button class="chip active" type="button" role="tab" id="tab-q" aria-controls="play-q" aria-selected="true" tabindex="0" data-tab="q">Episódios · T${ep.season}</button>
          <button class="chip" type="button" role="tab" id="tab-s" aria-controls="play-s" aria-selected="false" tabindex="-1" data-tab="s">Onde assistir</button>
        </div>
        <div id="play-q" role="tabpanel" aria-labelledby="tab-q" tabindex="0" class="play-panel">${list.map((e) => queueRow(ctx, e, ep, marker)).join('')}</div>
        <div id="play-s" role="tabpanel" aria-labelledby="tab-s" tabindex="0" class="play-panel" hidden><p class="hint">Procurando fontes…</p></div>
      </aside>
    </div>`;

  const host = root.querySelector('#play-host') as HTMLElement;
  const endEl = root.querySelector('#play-end') as HTMLElement;
  const srcPanel = root.querySelector('#play-s') as HTMLElement;
  const status = root.querySelector('#play-status') as HTMLElement | null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const live = new AbortController();
  const stopCountdown = () => {
    if (timer) clearInterval(timer);
    timer = null;
    endEl.hidden = true;
    endEl.innerHTML = '';
  };
  const teardown = () => {
    stopCountdown();
    live.abort();
    unsubscribeEnded();
  };

  /** Marca a fonte que está tocando na lista e lembra a escolha para o próximo episódio. */
  const highlight = (dto: TitleStreamsDto, pick: StreamPick) => {
    for (const b of srcPanel.querySelectorAll<HTMLElement>('[data-addon]')) {
      const on = b.dataset.addon === pick.addonId && Number(b.dataset.index) === pick.index;
      b.closest('li')?.classList.toggle('is-playing', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
    const found = findAddonStream(dto, pick.addonId, pick.index);
    if (found) savePref({ addonId: pick.addonId, height: streamFacts(found.stream).height });
  };

  const startStreams = (dto: TitleStreamsDto) => {
    if (!root.isConnected) return;
    if (!dto.addons.length) {
      srcPanel.innerHTML = '<p class="hint">Instale um addon de streams em <a href="#/addons">Addons</a> para assistir aqui.</p>';
      if (status) status.textContent = 'Nenhum addon de streams instalado.';
      return;
    }
    mountStreams(srcPanel, dto, {
      title: `${ctx.seriesTitle} · ${episodeCode(ep)}`,
      posterUrl: hd,
      route: playPath(ctx.source, ctx.id, ep.season, ep.number),
      playerHost: host,
      captions: (() => {
        const q = ctx.query(ep);
        return 'unavailable' in q ? null : { query: ep.name, ...(q.tmdbId ? { tmdbId: q.tmdbId } : {}), mediaType: q.mediaType, season: ep.season, episode: ep.number };
      })(),
    });
    // Captura: roda antes do `onclick` do painel, que é quem efetivamente toca.
    srcPanel.addEventListener(
      'click',
      (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-addon]');
        if (!b) return;
        stopCountdown();
        const found = findAddonStream(dto, b.dataset.addon, Number(b.dataset.index));
        if (found && isPlayable(found.stream)) highlight(dto, { addonId: found.group.addonId, index: found.stream.index });
      },
      { capture: true, signal: live.signal },
    );
    const pick = pickStream(dto, readPref(), explicit);
    if (!pick) {
      host.innerHTML = `${hd ? `<img class="play-poster" src="${escapeHtml(hd)}" alt="" />` : ''}<p class="play-status" role="status">Nenhuma fonte tocável aqui; veja os links externos em “Onde assistir”.</p>`;
      return;
    }
    let btn = srcPanel.querySelector<HTMLElement>(`[data-addon="${CSS.escape(pick.addonId)}"][data-index="${pick.index}"]`);
    if (!btn) {
      // Escondido na prévia ("mostrar todos"): abre a lista do addon para o botão existir.
      srcPanel.querySelector<HTMLElement>(`[data-more="${CSS.escape(pick.addonId)}"]`)?.click();
      btn = srcPanel.querySelector<HTMLElement>(`[data-addon="${CSS.escape(pick.addonId)}"][data-index="${pick.index}"]`);
    }
    btn?.click();
  };

  const q = ctx.query(ep);
  if ('unavailable' in q) {
    srcPanel.innerHTML = `<p class="hint">${escapeHtml(q.unavailable)}</p>`;
    if (status) status.textContent = q.unavailable;
  } else {
    getTitleStreams(q)
      .then(startStreams)
      .catch(() => {
        if (!root.isConnected) return;
        srcPanel.innerHTML = '<p class="hint" role="alert">Não foi possível consultar os addons agora.</p>';
        if (status) status.textContent = 'Não foi possível consultar os addons agora.';
      });
  }

  const mark = () =>
    markThrough(ctx.titleId, ep.season, ep.number, (m) => {
      marker = m;
      const panel = root.querySelector('#play-q');
      if (panel) panel.innerHTML = list.map((e) => queueRow(ctx, e, ep, marker)).join('');
    }).catch(() => {
      // markThrough já avisou no toast.
    });

  /** Fim do episódio: marca como visto e, com a reprodução automática ligada, conta até abrir o próximo. */
  const onEnded = () => {
    if (!root.isConnected) return teardown();
    if (!isEpisodeWatched(marker, ep.season, ep.number)) void mark();
    if (!next) return;
    let left = COUNTDOWN;
    const auto = getAutoplay();
    endEl.hidden = false;
    endEl.innerHTML = `<div class="watch-end-card" role="alert">
        <small>Fim de ${episodeCode(ep)}</small>
        <b>A seguir: T${next.season} · E${String(next.episode).padStart(2, '0')}</b>
        <span id="play-count">${auto ? `começa em ${left}s, com a mesma fonte` : ''}</span>
        <div class="watch-end-actions">
          <button class="btn btn-primary btn-sm" type="button" data-end="go">Assistir agora</button>
          <button class="btn btn-ghost btn-sm" type="button" data-end="stay">Ficar aqui</button>
        </div></div>`;
    (endEl.querySelector('[data-end="go"]') as HTMLElement).focus();
    // Voltar a tocar (replay, arrastar a barra) cancela a contagem: senão a tela troca no meio do vídeo.
    getVideo()?.addEventListener('play', stopCountdown, { once: true, signal: live.signal });
    if (!auto) return;
    timer = setInterval(() => {
      if (!root.isConnected) return teardown();
      left -= 1;
      if (left <= 0) {
        stopCountdown();
        go(next);
        return;
      }
      const label = endEl.querySelector('#play-count');
      if (label) label.textContent = `começa em ${left}s, com a mesma fonte`;
    }, 1000);
  };
  const unsubscribeEnded = subscribeEnded(onEnded);
  disposeCurrent = teardown;

  const tabs = [...root.querySelectorAll<HTMLElement>('[data-tab]')];
  const selectTab = (t: HTMLElement) => {
    for (const tab of tabs) {
      const on = tab === t;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = root.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`);
      if (panel) panel.hidden = !on;
    }
  };
  // Padrão ARIA de abas: setas, Home e End trocam e focam a aba.
  root.querySelector('[role="tablist"]')?.addEventListener(
    'keydown',
    (e) => {
      const ke = e as KeyboardEvent;
      const i = tabs.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      const to = ke.key === 'ArrowRight' ? (i + 1) % tabs.length : ke.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : ke.key === 'Home' ? 0 : ke.key === 'End' ? tabs.length - 1 : -1;
      const tab = tabs[to];
      if (!tab) return;
      ke.preventDefault();
      selectTab(tab);
      tab.focus();
    },
    { signal: live.signal },
  );
  root.addEventListener(
    'click',
    (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.step) go(t.dataset.step === '1' ? next : prev);
      else if ('mark' in t.dataset) void mark();
      else if (t.dataset.end === 'go') go(next);
      else if (t.dataset.end === 'stay') stopCountdown();
      else if (t.dataset.tab) selectTab(t);
    },
    { signal: live.signal },
  );
  (root.querySelector('#play-auto') as HTMLInputElement).addEventListener('change', (e) => setAutoplay((e.target as HTMLInputElement).checked), { signal: live.signal });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!root.isConnected) return teardown();
      if (e.repeat || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && next) go(next);
      else if (k === 'p' && prev) go(prev);
    },
    { signal: live.signal },
  );
  // Rola só a lista (não a página): no celular a lista fica abaixo do vídeo e o player precisa continuar à vista.
  const queuePanel = root.querySelector<HTMLElement>('#play-q');
  const current = queuePanel?.querySelector<HTMLElement>('[aria-current="true"]');
  if (queuePanel && current) queuePanel.scrollTop = current.offsetTop - 8;
};

/** Player dedicado de um episódio: vídeo grande, fila da temporada e todas as fontes na lateral. */
export const renderEpisodePlay = (host: HTMLElement, source: PlaySource, id: string, season: number, episode: number, query: URLSearchParams): void => {
  disposeCurrent?.();
  disposeCurrent = null;
  const root = document.createElement('div');
  host.replaceChildren(root);
  root.innerHTML = '<div class="skeleton" style="height:420px;border-radius:20px"></div>';
  // Sair para outra tela também desmonta (a próxima rota não sabe deste player).
  addEventListener('hashchange', () => !location.hash.startsWith('#/play/') && disposeCurrent?.(), { once: true });
  const addon = query.get('addon');
  const rawIndex = query.get('i');
  const index = rawIndex === null || rawIndex === '' ? Number.NaN : Number(rawIndex);
  const explicit = addon && Number.isInteger(index) && index >= 0 ? { addonId: addon, index } : null;
  loadPlayContext(source, id)
    .then(async (ctx) => {
      const list = await ctx.episodes(season);
      if (!root.isConnected) return;
      // Número fora da temporada (vindo do vizinho de outra temporada): encaixa no primeiro/último que existe.
      const sorted = [...list].sort((a, b) => a.number - b.number);
      const ep = list.find((e) => e.number === episode) ?? (episode < (sorted[0]?.number ?? 0) ? sorted[0] : episode > (sorted.at(-1)?.number ?? 0) ? sorted.at(-1) : undefined);
      if (!ep) {
        root.innerHTML = `<div class="empty-state"><div class="big">${icon('film')}</div>episódio não encontrado — <a href="${ctx.backHref}">voltar à série</a></div>`;
        return;
      }
      render(root, ctx, list, ep, explicit);
    })
    .catch(() => {
      if (root.isConnected) root.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar este episódio</div>`;
    });
};
