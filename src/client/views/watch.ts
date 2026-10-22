import { getTelegramChannel, listTelegramChannels, type TelegramChannelDetailDto, type TelegramChannelDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import {
  type DockItem,
  getAutoplay,
  getNowPlaying,
  getQueueOrder,
  getVideo,
  minimizePlayer,
  playIndex,
  type QueueOrder,
  setAutoplay,
  setQueueOrder,
  showInPage,
  subscribeEnded,
  subscribePlayer,
} from '../components/player-dock.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { itemDescription, orderItems, pickNextChannel, toDockItem, watchPath } from '../telegram-items.ts';
import { formatDuration } from '../time-format.ts';

const SEEK_SECONDS = 10;
const NEXT_CHANNEL_COUNTDOWN = 8;

const nextRow = (item: DockItem, i: number): string => {
  const length = formatDuration(item.durationSeconds);
  return `<button type="button" class="next-item" data-i="${i}">
    <span class="next-thumb"${item.poster ? ` style="background-image:url('${escapeHtml(item.poster)}')"` : ''}>${item.poster ? '' : icon('film')}${length ? `<small>${length}</small>` : ''}</span>
    <span class="next-text"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span>
  </button>`;
};

const channelRow = (ch: TelegramChannelDto): string => `
  <button type="button" class="next-item next-channel" data-channel="${escapeHtml(ch.titleId)}">
    <span class="next-thumb"${ch.posterUrl ? ` style="background-image:url('${escapeHtml(ch.posterUrl)}')"` : ''}>${ch.posterUrl ? '' : icon('send')}</span>
    <span class="next-text"><b>${escapeHtml(ch.title)}</b><small>${ch.itemCount} vídeo${ch.itemCount === 1 ? '' : 's'}</small></span>
  </button>`;

const togglePlay = (v: HTMLVideoElement): void => {
  if (v.paused) void v.play();
  else v.pause();
};

/** Teclas no estilo do YouTube; ignoradas quando o foco já está em algo que as trata (vídeo, campo, botão, link). */
const onKey = (e: KeyboardEvent): void => {
  const v = getVideo();
  if (!v || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as HTMLElement).closest('video, input, textarea, select, button, a, [role="slider"]')) return;
  const actions: Record<string, () => void> = {
    ' ': () => togglePlay(v),
    k: () => togglePlay(v),
    j: () => {
      v.currentTime = Math.max(0, v.currentTime - SEEK_SECONDS);
    },
    l: () => {
      v.currentTime = Math.min(v.duration || Number.POSITIVE_INFINITY, v.currentTime + SEEK_SECONDS);
    },
    m: () => {
      v.muted = !v.muted;
    },
    f: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void v.requestFullscreen?.();
    },
    n: () => {
      const now = getNowPlaying();
      if (now) playIndex(now.index + 1);
    },
  };
  const action = actions[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  action();
};

const render = (host: HTMLElement, d: TelegramChannelDetailDto, channels: TelegramChannelDto[], messageId: string): void => {
  let order: QueueOrder = getQueueOrder();
  let items = orderItems(d.items, order);
  const nextChannel = pickNextChannel(channels, d.titleId);
  // "start" = o primeiro vídeo na ordem escolhida (usado ao pular para outro canal).
  const first = messageId === 'start' ? items[0]?.messageId : messageId;
  const toQueue = () => items.map((item) => toDockItem(d, item));
  let queue = toQueue();
  const start = queue.findIndex((i) => i.messageId === first);
  if (start < 0) {
    host.innerHTML = `<div class="empty-state"><div class="big">${icon('film')}</div>vídeo não encontrado neste canal — <a href="#/telegram/${escapeHtml(d.titleId)}">voltar ao canal</a></div>`;
    return;
  }

  host.innerHTML = `
    <div class="watch">
      <div class="watch-main">
        <div class="watch-stage" id="watch-stage"><div class="watch-end" id="watch-end" hidden></div></div>
        <div id="watch-info"></div>
      </div>
      <aside class="watch-next" aria-label="Próximos vídeos">
        <div class="watch-next-head">
          <h2>Próximos vídeos</h2>
          <label class="switch"><input type="checkbox" id="autoplay"${getAutoplay() ? ' checked' : ''} /> reprodução automática</label>
        </div>
        <label class="watch-order">Ordem
          <select class="select" id="queue-order" aria-label="Ordem da fila de vídeos">
            <option value="newest"${order === 'newest' ? ' selected' : ''}>Mais recentes primeiro</option>
            <option value="oldest"${order === 'oldest' ? ' selected' : ''}>Mais antigos primeiro</option>
          </select>
        </label>
        <div id="watch-list"></div>
      </aside>
    </div>`;

  const stage = host.querySelector('#watch-stage') as HTMLElement;
  const endEl = host.querySelector('#watch-end') as HTMLElement;
  const infoEl = host.querySelector('#watch-info') as HTMLElement;
  const listEl = host.querySelector('#watch-list') as HTMLElement;
  let countdown: ReturnType<typeof setInterval> | null = null;

  const hideEnd = () => {
    if (countdown) clearInterval(countdown);
    countdown = null;
    endEl.hidden = true;
    endEl.innerHTML = '';
  };

  const goNextChannel = () => {
    if (nextChannel) navigate(watchPath(nextChannel.titleId, 'start'));
  };

  /** Acabaram os vídeos do canal: sugere o próximo (com contagem, se a reprodução automática estiver ligada). */
  const suggestNextChannel = () => {
    if (!nextChannel || !stage.isConnected) return;
    let left = NEXT_CHANNEL_COUNTDOWN;
    const auto = getAutoplay();
    endEl.hidden = false;
    endEl.innerHTML = `
      <div class="watch-end-card" role="alert">
        <small>Fim dos vídeos de ${escapeHtml(d.title)}</small>
        <b>Próximo canal: ${escapeHtml(nextChannel.title)}</b>
        <span id="end-count">${auto ? `começa em ${left}s` : ''}</span>
        <div class="watch-end-actions">
          <button class="btn btn-primary btn-sm" id="end-go" type="button">Assistir agora</button>
          <button class="btn btn-ghost btn-sm" id="end-cancel" type="button">Ficar aqui</button>
        </div>
      </div>`;
    (endEl.querySelector('#end-go') as HTMLElement).focus();
    if (!auto) return;
    countdown = setInterval(() => {
      if (!stage.isConnected) return hideEnd();
      left -= 1;
      if (left <= 0) {
        hideEnd();
        goNextChannel();
        return;
      }
      const label = endEl.querySelector('#end-count');
      if (label) label.textContent = `começa em ${left}s`;
    }, 1000);
  };

  /** Vídeo retrato (9:16 etc.) ganha um palco com a proporção dele em vez de faixas pretas enormes. */
  const fitStage = () => {
    const v = getVideo();
    if (!v?.videoWidth || !v.videoHeight) return;
    const portrait = v.videoHeight > v.videoWidth;
    stage.classList.toggle('portrait', portrait);
    stage.style.aspectRatio = portrait ? `${v.videoWidth} / ${v.videoHeight}` : '';
  };

  const paint = () => {
    const now = getNowPlaying();
    const detail = now ? d.items.find((i) => i.messageId === now.item.messageId) : undefined;
    if (!now || !detail) return;
    const description = itemDescription(detail);
    const meta = [detail.postedAt ? new Date(detail.postedAt).toLocaleDateString('pt-BR') : null, formatDuration(detail.durationSeconds)].filter(Boolean).join(' · ');
    document.title = `${now.item.title} — nerd-watch`;
    infoEl.innerHTML = `
      <h1 class="watch-title">${escapeHtml(now.item.title)}</h1>
      <div class="watch-channel">
        <a class="watch-avatar" href="#/telegram/${escapeHtml(d.titleId)}"${d.posterUrl ? ` style="background-image:url('${escapeHtml(d.posterUrl)}')"` : ''} aria-hidden="true" tabindex="-1"></a>
        <div class="watch-channel-text"><a href="#/telegram/${escapeHtml(d.titleId)}"><b>${escapeHtml(d.title)}</b></a><small>${escapeHtml(meta)}</small></div>
        <div class="watch-actions">
          <button class="btn btn-ghost btn-sm" id="watch-minimize" type="button">${icon('minimize', 'sm')} Minimizar</button>
          <a class="btn btn-ghost btn-sm" href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">Abrir no Telegram</a>
        </div>
      </div>
      ${description ? `<p class="watch-desc">${escapeHtml(description)}</p>` : ''}`;

    // Antes do atual na fila = já passou na ordem escolhida; entram depois dos próximos para a lista nunca ficar vazia.
    const upcoming = now.queue.slice(now.index + 1);
    const earlier = now.queue.slice(0, now.index);
    listEl.innerHTML = `
      ${upcoming.map((it, k) => nextRow(it, now.index + 1 + k)).join('')}
      ${earlier.length ? `<h3 class="watch-more">${order === 'newest' ? 'Mais recentes' : 'Mais antigos'}</h3>${earlier.map((it, k) => nextRow(it, k)).join('')}` : ''}
      ${upcoming.length + earlier.length === 0 ? '<p class="hint">Este canal só tem este vídeo por enquanto.</p>' : ''}
      ${nextChannel ? `<h3 class="watch-more">Próximo canal</h3>${channelRow(nextChannel)}` : ''}`;
    // Mantém a barra do navegador no vídeo atual quando a reprodução automática troca de item.
    history.replaceState(null, '', `#${watchPath(d.titleId, now.item.messageId)}`);
    fitStage();
  };

  listEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-channel]')) return goNextChannel();
    const btn = target.closest<HTMLElement>('[data-i]');
    if (btn) playIndex(Number(btn.dataset.i));
  });
  infoEl.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#watch-minimize')) return;
    minimizePlayer();
    navigate(`/telegram/${d.titleId}`);
  });
  endEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#end-go')) goNextChannel();
    else if (target.closest('#end-cancel')) hideEnd();
  });
  (host.querySelector('#autoplay') as HTMLInputElement).addEventListener('change', (e) => setAutoplay((e.target as HTMLInputElement).checked));

  // Trocar a ordem refaz a fila mantendo o vídeo atual (e o tempo dele) como está.
  (host.querySelector('#queue-order') as HTMLSelectElement).addEventListener('change', (e) => {
    order = (e.target as HTMLSelectElement).value as QueueOrder;
    setQueueOrder(order);
    items = orderItems(d.items, order);
    queue = toQueue();
    const playing = getNowPlaying()?.item.messageId;
    showInPage(queue, Math.max(0, queue.findIndex((i) => i.messageId === playing)), stage);
  });

  showInPage(queue, start, stage);
  const video = getVideo();
  video?.addEventListener('loadedmetadata', fitStage);
  video?.addEventListener('play', hideEnd);

  const unsubscribeEnded = subscribeEnded(suggestNextChannel);
  const unsubscribe = subscribePlayer(() => {
    if (!stage.isConnected) {
      unsubscribe();
      unsubscribeEnded();
      hideEnd();
      document.removeEventListener('keydown', onKey);
      getVideo()?.removeEventListener('loadedmetadata', fitStage);
      getVideo()?.removeEventListener('play', hideEnd);
      return;
    }
    paint();
  });
  document.addEventListener('keydown', onKey);
  paint();
};

/** Tela de reprodução (estilo YouTube): vídeo grande, dados do canal, próximos vídeos e o próximo canal. */
export const renderWatch = (host: HTMLElement, channelId: string, messageId: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:420px;border-radius:20px"></div>`;
  Promise.all([getTelegramChannel(channelId), listTelegramChannels().then((r) => r.channels, () => [] as TelegramChannelDto[])])
    .then(([d, channels]) => render(host, d, channels, messageId))
    .catch(() => {
      host.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar este vídeo</div>`;
    });
};
