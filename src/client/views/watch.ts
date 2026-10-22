import { getTelegramChannel, type TelegramChannelDetailDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { type DockItem, getAutoplay, getNowPlaying, getVideo, minimizePlayer, playIndex, setAutoplay, showInPage, subscribePlayer } from '../components/player-dock.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { itemDescription, toDockItem, watchPath } from '../telegram-items.ts';
import { formatDuration } from '../time-format.ts';

const SEEK_SECONDS = 10;

const nextRow = (item: DockItem, i: number): string => {
  const length = formatDuration(item.durationSeconds);
  return `<button type="button" class="next-item" data-i="${i}">
    <span class="next-thumb"${item.poster ? ` style="background-image:url('${escapeHtml(item.poster)}')"` : ''}>${item.poster ? '' : icon('film')}${length ? `<small>${length}</small>` : ''}</span>
    <span class="next-text"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span>
  </button>`;
};

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

const render = (host: HTMLElement, d: TelegramChannelDetailDto, messageId: string): void => {
  const queue = d.items.map((item) => toDockItem(d, item));
  const start = queue.findIndex((i) => i.messageId === messageId);
  if (start < 0) {
    host.innerHTML = `<div class="empty-state"><div class="big">${icon('film')}</div>vídeo não encontrado neste canal — <a href="#/telegram/${escapeHtml(d.titleId)}">voltar ao canal</a></div>`;
    return;
  }

  host.innerHTML = `
    <div class="watch">
      <div class="watch-main">
        <div class="watch-stage" id="watch-stage"></div>
        <div id="watch-info"></div>
      </div>
      <aside class="watch-next" aria-label="Próximos vídeos">
        <div class="watch-next-head">
          <h2>Próximos vídeos</h2>
          <label class="switch"><input type="checkbox" id="autoplay"${getAutoplay() ? ' checked' : ''} /> reprodução automática</label>
        </div>
        <div id="watch-list"></div>
      </aside>
    </div>`;

  const stage = host.querySelector('#watch-stage') as HTMLElement;
  const infoEl = host.querySelector('#watch-info') as HTMLElement;
  const listEl = host.querySelector('#watch-list') as HTMLElement;

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
    const detail = now ? d.items[now.index] : undefined;
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

    const upcoming = now.queue.slice(now.index + 1);
    const earlier = now.queue.slice(0, now.index);
    // Os seguintes tocam na reprodução automática; os anteriores seguem listados para o último vídeo nunca deixar a lista vazia.
    listEl.innerHTML = `
      ${upcoming.map((it, k) => nextRow(it, now.index + 1 + k)).join('')}
      ${earlier.length ? `<h3 class="watch-more">${upcoming.length ? 'Anteriores' : 'Mais do canal'}</h3>${earlier.map((it, k) => nextRow(it, k)).join('')}` : ''}
      ${upcoming.length + earlier.length === 0 ? '<p class="hint">Este canal só tem este vídeo por enquanto.</p>' : ''}`;
    // Mantém a barra do navegador no vídeo atual quando a reprodução automática troca de item.
    history.replaceState(null, '', `#${watchPath(d.titleId, now.item.messageId)}`);
    fitStage();
  };

  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (btn) playIndex(Number(btn.dataset.i));
  });
  infoEl.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#watch-minimize')) return;
    minimizePlayer();
    navigate(`/telegram/${d.titleId}`);
  });
  (host.querySelector('#autoplay') as HTMLInputElement).addEventListener('change', (e) => setAutoplay((e.target as HTMLInputElement).checked));

  showInPage(queue, start, stage);
  getVideo()?.addEventListener('loadedmetadata', fitStage);

  const unsubscribe = subscribePlayer(() => {
    if (!stage.isConnected) {
      unsubscribe();
      document.removeEventListener('keydown', onKey);
      getVideo()?.removeEventListener('loadedmetadata', fitStage);
      return;
    }
    paint();
  });
  document.addEventListener('keydown', onKey);
  paint();
};

/** Tela de reprodução (estilo YouTube): vídeo grande, dados do canal e os próximos vídeos do canal ao lado. */
export const renderWatch = (host: HTMLElement, channelId: string, messageId: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:420px;border-radius:20px"></div>`;
  getTelegramChannel(channelId)
    .then((d) => render(host, d, messageId))
    .catch(() => {
      host.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar este vídeo</div>`;
    });
};
