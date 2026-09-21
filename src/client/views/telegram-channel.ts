import Plyr from 'plyr';
import { getTelegramChannel, refreshTelegramChannel, telegramPlayUrl, type TelegramChannelDetailDto, type TelegramItemDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { showToast } from '../state.ts';

const PLYR_CONTROLS = ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'];

/** Vídeo retrato (9:16 etc.) esticaria até a largura toda do container — trava a largura pelo orçamento de altura. */
const capPortraitWidth = (container: HTMLElement, video: HTMLVideoElement): (() => void) => {
  const apply = () => {
    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) return;
    const heightBudget = Math.min(window.innerHeight * 0.72, 720);
    container.style.maxWidth = h > w ? `${Math.round((heightBudget * w) / h)}px` : '';
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener('loadedmetadata', apply, { once: true });
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
};

const MODE_LABEL: Record<TelegramChannelDetailDto['mode'], string> = {
  public: 'canal público',
  bot: 'bot',
  personal: 'conta pessoal',
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/** Telegram não tem campo de título — usa a 1ª linha da legenda como título e o resto como descrição. */
const itemTitle = (item: TelegramItemDto, maxLen = 80): string => {
  const firstLine = item.caption?.split('\n').find((l) => l.trim().length > 0);
  return firstLine ? firstLine.slice(0, maxLen) : `Vídeo — mensagem ${item.messageId}`;
};

const itemDescription = (item: TelegramItemDto): string | null => {
  if (!item.caption) return null;
  const rest = item.caption
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(1)
    .join(' ')
    .trim();
  return rest || null;
};

interface PlayerState {
  player: Plyr | null;
  cleanupResize: (() => void) | null;
}

export const renderTelegramChannel = (host: HTMLElement, titleId: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const playerState: PlayerState = { player: null, cleanupResize: null };

  const load = () => {
    getTelegramChannel(titleId)
      .then((d) => renderDetail(host, d, load, playerState))
      .catch(() => {
        host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar esse canal</div>`;
      });
  };

  load();
};

/** Toda vez que `reload()` reconstrói o DOM (troca de status/nota, "atualizar"), o player anterior precisa ser destruído antes — senão o Plyr e o listener de resize de `capPortraitWidth` vazam a cada re-render. */
const renderDetail = (host: HTMLElement, d: TelegramChannelDetailDto, reload: () => void, playerState: PlayerState): void => {
  playerState.player?.destroy();
  playerState.cleanupResize?.();
  playerState.player = null;
  playerState.cleanupResize = null;

  host.innerHTML = `
    <div class="hero">
      <div class="backdrop${d.posterUrl ? '' : ' placeholder'}"${d.posterUrl ? ` style="background-image:url('${escapeHtml(d.posterUrl)}')"` : ''}></div>
      <div class="scrim"></div>
      <div class="hero-content">
        <div class="hero-info">
          <h1>${escapeHtml(d.title)}</h1>
          <div class="hero-meta">
            <span class="badge badge-archive">telegram · ${MODE_LABEL[d.mode]}</span>
            <span>${d.itemCount} vídeo${d.itemCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div id="tg-player"></div>
        <div class="section-head"><h2>🎬 Vídeos</h2>${d.mode === 'public' || d.mode === 'personal' ? `<button class="btn btn-ghost btn-sm" id="tg-refresh">🔄 atualizar</button>` : ''}</div>
        ${d.mode === 'bot' ? `<p class="hint" style="margin-top:-10px;margin-bottom:14px">modo bot só recebe vídeos postados a partir de agora — sem histórico retroativo.</p>` : ''}
        <div id="tg-items" class="grid"></div>
      </div>
      <div>
        <div class="side-card">
          <h3>Sua lista</h3>
          <div id="status-actions"></div>
        </div>
      </div>
    </div>
  `;

  const statusHost = host.querySelector('#status-actions') as HTMLElement;
  statusHost.appendChild(
    renderStatusActions({
      titleId: d.titleId,
      entryId: d.library?.id ?? null,
      watchStatus: d.library?.watch_status ?? null,
      rating: d.library?.rating ?? null,
      onChange: () => reload(),
    }),
  );

  const playerHost = host.querySelector('#tg-player') as HTMLElement;
  const itemsHost = host.querySelector('#tg-items') as HTMLElement;

  const playItem = (item: TelegramItemDto) => {
    playerState.player?.destroy();
    playerState.cleanupResize?.();
    const playUrl = telegramPlayUrl(d.titleId, item.messageId);
    const meta = [formatDuration(item.durationSeconds), item.postedAt ? new Date(item.postedAt).toLocaleDateString('pt-BR') : null]
      .filter(Boolean)
      .join(' · ');
    const description = itemDescription(item);
    playerHost.innerHTML = `
      <div class="tg-player-heading">
        <h3>${escapeHtml(itemTitle(item))}</h3>
        ${meta ? `<div class="tg-player-meta">${escapeHtml(meta)}</div>` : ''}
      </div>
      <div class="tg-player">
        <video src="${escapeHtml(playUrl)}" autoplay playsinline ${item.thumbnailUrl ? `poster="${escapeHtml(item.thumbnailUrl)}"` : ''}></video>
      </div>
      ${description ? `<p class="view-subtitle">${escapeHtml(description)}</p>` : ''}
    `;
    const video = playerHost.querySelector('video') as HTMLVideoElement;
    video.addEventListener('error', () => {
      // Range mínimo: sem isso, no modo conta pessoal um erro de player dispararia um download completo do vídeo só pra ler o corpo de erro.
      fetch(playUrl, { headers: { Range: 'bytes=0-0' } })
        .then((r) => r.json())
        .then((body) => showToast(body.error ?? 'não foi possível reproduzir esse vídeo'))
        .catch(() => showToast('não foi possível reproduzir esse vídeo'));
    });
    playerState.player = new Plyr(video, { controls: PLYR_CONTROLS });
    playerState.cleanupResize = capPortraitWidth(playerState.player.elements.container, video);
    playerHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (d.items.length === 0) {
    const emptyMessage =
      d.mode === 'bot'
        ? 'nenhum vídeo ainda — o bot precisa estar adicionado como admin do canal, e só grava o que for postado a partir de agora'
        : 'nenhum vídeo encontrado nesse canal ainda';
    itemsHost.outerHTML = `<div class="empty-state"><div class="big">📭</div>${emptyMessage}</div>`;
  } else {
    for (const item of d.items) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="poster${item.thumbnailUrl ? '' : ' placeholder'}"${item.thumbnailUrl ? ` style="background-image:url('${escapeHtml(item.thumbnailUrl)}')"` : ''}>
          ${item.thumbnailUrl ? '' : '<span class="initials">🎬</span>'}
          ${item.durationSeconds ? `<span class="badge badge-corner">${formatDuration(item.durationSeconds)}</span>` : ''}
        </div>
        <div class="meta">
          <div class="title">${escapeHtml(itemTitle(item, 60))}</div>
          ${item.postedAt ? `<div class="sub">${new Date(item.postedAt).toLocaleDateString('pt-BR')}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => playItem(item));
      itemsHost.appendChild(card);
    }
  }

  const refreshBtn = host.querySelector('#tg-refresh') as HTMLButtonElement | null;
  refreshBtn?.addEventListener('click', () => {
    refreshBtn.disabled = true;
    refreshTelegramChannel(d.titleId)
      .then((res) => {
        showToast(`canal atualizado — ${res.itemCount} vídeo(s)`);
        reload();
      })
      .catch(() => showToast('não foi possível atualizar agora'))
      .finally(() => {
        refreshBtn.disabled = false;
      });
  });
};
