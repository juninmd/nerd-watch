import Plyr from 'plyr';
import { closeTorrent, getTorrentStatus, health, openTorrent, type TorrentOpenResponse } from '../api.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

const PLYR_CONTROLS = ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'];
const POLL_MS = 2000;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/**
 * Registrar o cleanup aqui (em vez de no router) resolve o vazamento: sem isso, navegar para
 * outra tela deixaria o torrent aberto semeando e o `setInterval` de status rodando pra sempre.
 */
const cleanups = new Set<() => void>();

/** Chamado a cada troca de rota (`main.ts`). Fecha torrents e mata os pollers da tela anterior. */
export const releaseTorrentPlayers = (): void => {
  for (const cleanup of [...cleanups]) cleanup();
  cleanups.clear();
};

export interface TorrentPanelOptions {
  identifier: string;
  title: string;
  posterUrl?: string | null;
}

interface PanelState {
  infoHash: string | null;
  timer: ReturnType<typeof setInterval> | null;
  player: Plyr | null;
  /** Só a troca de rota marca isto. "Parar" NÃO marca: o painel continua utilizável. */
  disposed: boolean;
}

export const renderTorrentPanel = (opts: TorrentPanelOptions): HTMLElement => {
  const wrap = document.createElement('div');
  const state: PanelState = { infoHash: null, timer: null, player: null, disposed: false };

  /** Para a reprodução (poller + Plyr). NÃO fecha o torrent: trocar de derivado o reaproveita. */
  const stopPlayback = () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    state.player?.destroy();
    state.player = null;
  };

  /** Para tudo e fecha o torrent no servidor: para de baixar/semear e libera o disco. */
  const releaseTorrent = () => {
    const infoHash = state.infoHash;
    state.infoHash = null;
    stopPlayback();
    if (infoHash) closeTorrent(infoHash).catch(() => {});
  };

  const release = () => {
    state.disposed = true;
    releaseTorrent();
  };
  cleanups.add(release);

  const idle = (message = '') => {
    wrap.innerHTML = `
      ${message ? `<p class="hint" style="margin:0 0 8px">${escapeHtml(message)}</p>` : ''}
      <button class="btn btn-primary btn-sm" id="torrent-start" type="button" style="width:100%;justify-content:center">
        🧲 assistir via torrent (P2P)
      </button>
      <p class="hint" style="margin:8px 0 0">
        Conecta direto nos peers que hospedam o torrent oficial da Internet Archive —
        não passa pela banda do archive.org.
      </p>
    `;
    (wrap.querySelector('#torrent-start') as HTMLButtonElement).addEventListener('click', () => void start());
  };

  const chooseFile = (result: TorrentOpenResponse) => {
    if (result.videoFiles.length < 2) return '';
    const options = result.videoFiles
      .map(
        (file) =>
          `<option value="${file.index}"${file.index === result.selected.index ? ' selected' : ''}>${escapeHtml(
            `${file.label} — ${formatBytes(file.length)}`,
          )}</option>`,
      )
      .join('');
    return `<select class="torrent-file-select" id="torrent-file" style="width:100%;margin-bottom:8px">${options}</select>`;
  };

  const playing = (result: TorrentOpenResponse) => {
    wrap.innerHTML = `
      ${chooseFile(result)}
      <div class="player-frame" style="margin-bottom:8px">
        <video id="torrent-video" src="${escapeHtml(result.streamUrl)}" controls playsinline autoplay
          ${opts.posterUrl ? `poster="${escapeHtml(opts.posterUrl)}"` : ''}></video>
      </div>
      <div class="torrent-stats" id="torrent-stats" style="margin-bottom:8px">conectando aos peers...</div>
      <button class="btn btn-ghost btn-sm" id="torrent-stop" type="button" style="width:100%;justify-content:center">
        ⏹ parar e liberar o torrent
      </button>
    `;

    const video = wrap.querySelector('#torrent-video') as HTMLVideoElement;
    state.player = new Plyr(video, { controls: PLYR_CONTROLS });

    video.addEventListener('error', () => showToast('não foi possível reproduzir esse arquivo do torrent'));

    (wrap.querySelector('#torrent-stop') as HTMLButtonElement).addEventListener('click', () => {
      releaseTorrent();
      idle();
    });

    const select = wrap.querySelector('#torrent-file') as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      // Não fecha o torrent: o servidor reaproveita o handle e só troca `fileIndex`, então os
      // pedaços já baixados continuam válidos.
      void start(Number(select.value));
    });

    const statsEl = wrap.querySelector('#torrent-stats') as HTMLElement;
    const poll = () => {
      getTorrentStatus(result.infoHash)
        .then((status) => {
          if (state.disposed) return;
          statsEl.innerHTML = `
            <span class="badge">${status.numPeers} peer${status.numPeers === 1 ? '' : 's'}</span>
            <span class="badge">${formatBytes(status.downloadSpeed)}/s</span>
            <span class="badge">${(status.progress * 100).toFixed(1)}% baixado</span>
            <span class="badge">${formatBytes(status.downloaded)} de ${formatBytes(status.totalLength)}</span>
          `;
        })
        .catch(() => {
          if (state.disposed) return;
          statsEl.textContent = 'perdemos o torrent — use "parar" e tente de novo';
        });
    };
    poll();
    state.timer = setInterval(poll, POLL_MS);
  };

  const start = async (fileIndex?: number) => {
    stopPlayback();
    wrap.innerHTML = `<p class="hint">${escapeHtml(fileIndex === undefined ? 'buscando a metadata do torrent e os peers...' : 'trocando de arquivo...')}</p>`;
    try {
      const result = await openTorrent(opts.identifier, fileIndex);
      if (state.disposed) {
        closeTorrent(result.infoHash).catch(() => {});
        return;
      }
      state.infoHash = result.infoHash;
      playing(result);
    } catch (err) {
      if (state.disposed) return;
      // A mensagem fica visível: antes o `idle()` seguinte apagava o erro no mesmo tick e a
      // falha era silenciosa (o botão só reaparecia como se nada tivesse acontecido).
      idle(err instanceof Error ? err.message : 'não foi possível abrir o torrent');
    }
  };

  // O servidor pode ter o P2P desligado (TORRENT_ENABLED=false): sem esta checagem o botão
  // apareceria e o clique morreria num 501 que o usuário nunca veria.
  wrap.innerHTML = '<div class="skeleton" style="height:56px"></div>';
  health()
    .then((h) => {
      if (state.disposed) return;
      if (!h.torrentEnabled) {
        wrap.innerHTML = '<p class="hint" style="margin:0">P2P desligado neste servidor (<code>TORRENT_ENABLED=false</code>). Use o torrent oficial ao lado para baixar.</p>';
        return;
      }
      idle();
    })
    .catch(() => {
      if (!state.disposed) idle();
    });

  return wrap;
};
