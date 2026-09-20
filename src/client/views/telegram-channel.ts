import { getTelegramChannel, refreshTelegramChannel, telegramPlayUrl, type TelegramChannelDetailDto, type TelegramItemDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { showToast } from '../state.ts';

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

export const renderTelegramChannel = (host: HTMLElement, titleId: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    getTelegramChannel(titleId)
      .then((d) => renderDetail(host, d, load))
      .catch(() => {
        host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar esse canal</div>`;
      });
  };

  load();
};

const renderDetail = (host: HTMLElement, d: TelegramChannelDetailDto, reload: () => void): void => {
  host.innerHTML = `
    <div class="hero">
      <div class="backdrop${d.posterUrl ? '' : ' placeholder'}"${d.posterUrl ? ` style="background-image:url('${d.posterUrl}')"` : ''}></div>
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
    const playUrl = telegramPlayUrl(d.titleId, item.messageId);
    playerHost.innerHTML = `
      <div class="player-frame">
        <video src="${playUrl}" controls autoplay ${item.thumbnailUrl ? `poster="${item.thumbnailUrl}"` : ''}></video>
      </div>
      ${item.caption ? `<p class="view-subtitle" style="margin-top:-8px">${escapeHtml(item.caption)}</p>` : ''}
    `;
    const video = playerHost.querySelector('video') as HTMLVideoElement;
    video.addEventListener('error', () => {
      fetch(playUrl)
        .then((r) => r.json())
        .then((body) => showToast(body.error ?? 'não foi possível reproduzir esse vídeo'))
        .catch(() => showToast('não foi possível reproduzir esse vídeo'));
    });
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
        <div class="poster${item.thumbnailUrl ? '' : ' placeholder'}"${item.thumbnailUrl ? ` style="background-image:url('${item.thumbnailUrl}')"` : ''}>
          ${item.thumbnailUrl ? '' : '<span class="initials">🎬</span>'}
          ${item.durationSeconds ? `<span class="badge badge-corner">${formatDuration(item.durationSeconds)}</span>` : ''}
        </div>
        <div class="meta">
          <div class="title">${item.caption ? escapeHtml(item.caption.slice(0, 60)) : `mensagem ${escapeHtml(item.messageId)}`}</div>
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
