import { closeTorrent, getTorrentStatus, health, openTorrent, type TorrentOpenResponse } from '../api/index.ts';
import { icon } from '../ui/icons.ts';
import { titlePath } from '../ui/title-link.ts';
import { escapeHtml } from '../ui/card.ts';
import { renderInlinePlayer } from './inline-player.ts';
import { getNowPlaying, stopPlayer } from './player-dock.ts';

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
const cleanups = new Map<() => void, HTMLElement>();

/**
 * Fecha torrents e mata os pollers. Sem `root`, vale para a tela inteira (troca de rota); com `root`,
 * só os painéis dentro daquele nó (trocou a temporada ou fechou um episódio).
 */
export const releaseTorrentPlayers = (root?: Node): void => {
  for (const [cleanup, panel] of [...cleanups]) {
    if (!root || root.contains(panel)) cleanup();
  }
};

export interface TorrentPanelOptions {
  identifier: string;
  title: string;
  posterUrl?: string | null;
  /** Como abrir o torrent. Padrão: item do Internet Archive pelo `identifier`; addons passam o opener deles. */
  open?: (fileIndex?: number) => Promise<TorrentOpenResponse>;
  /** Rótulo sob o título no player (de onde vieram os bytes). */
  sourceLabel?: string;
  /** Rodapé do botão inicial: o que o usuário está prestes a fazer. */
  hint?: string;
  /** Identidade no player global e rota de retorno (o Archive usa o título; addon usa o item do addon). */
  player?: { channelId: string; messageId: string; route: string };
  /** Inicia o torrent logo ao montar (ex.: quando o usuário acabou de clicar num stream de addon). */
  autoStart?: boolean;
  /** Chamado quando o painel é liberado (troca de fonte, re-render ou rota) para limpar o DOM que o hospeda. */
  onRelease?: () => void;
}

const ARCHIVE_HINT = 'Conecta direto nos peers que hospedam o torrent oficial da Internet Archive — não passa pela banda do archive.org.';

interface PanelState {
  infoHash: string | null;
  timer: ReturnType<typeof setInterval> | null;
  /** Chave do vídeo que este painel colocou no player global (para pará-lo sem derrubar outro vídeo). */
  playerKey: string | null;
  /** Troca de rota/fonte ou re-render marca isto. "Parar" NÃO marca: o painel continua utilizável. */
  disposed: boolean;
}

export const renderTorrentPanel = (opts: TorrentPanelOptions): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.className = 'torrent-panel';
  const state: PanelState = { infoHash: null, timer: null, playerKey: null, disposed: false };
  const open = opts.open ?? ((fileIndex?: number) => openTorrent(opts.identifier, fileIndex));
  const playerRef = opts.player ?? { channelId: 'archive', messageId: opts.identifier, route: titlePath('archive', '_', opts.identifier) };

  /** Para a reprodução (poller + player). NÃO fecha o torrent: trocar de derivado o reaproveita. */
  const stopPlayback = () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (state.playerKey && getNowPlaying()?.item.key === state.playerKey) stopPlayer();
    state.playerKey = null;
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
    cleanups.delete(release);
    opts.onRelease?.();
  };
  cleanups.set(release, wrap);

  const idle = (message = '') => {
    wrap.innerHTML = `
      ${message ? `<p class="hint" style="margin:0 0 8px">${escapeHtml(message)}</p>` : ''}
      <button class="btn btn-primary btn-sm" id="torrent-start" type="button" style="width:100%;justify-content:center">
        ${icon('download', 'sm')} assistir via torrent (P2P)
      </button>
      <p class="hint" style="margin:8px 0 0">
        ${escapeHtml(opts.hint ?? ARCHIVE_HINT)}
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
    return `<select class="select input-sm" id="torrent-file" style="margin-bottom:8px">${options}</select>`;
  };

  const playing = (result: TorrentOpenResponse) => {
    wrap.innerHTML = `
      ${chooseFile(result)}
      <div id="torrent-player" style="margin-bottom:8px"></div>
      <div class="torrent-stats" id="torrent-stats" style="margin-bottom:8px">conectando aos peers...</div>
      <button class="btn btn-ghost btn-sm" id="torrent-stop" type="button" style="width:100%;justify-content:center">
        ${icon('stop', 'sm')} parar e liberar o torrent
      </button>
    `;

    // O mesmo player dos canais, sem "Minimizar": o torrent é fechado ao sair da tela, então o vídeo não sobrevive a ela.
    const key = `torrent:${result.infoHash}:${result.selected.index}`;
    state.playerKey = key;
    (wrap.querySelector('#torrent-player') as HTMLElement).appendChild(
      renderInlinePlayer({
        item: {
          key,
          src: result.streamUrl,
          title: opts.title,
          subtitle: opts.sourceLabel ?? 'Internet Archive · P2P',
          poster: opts.posterUrl ?? null,
          channelId: playerRef.channelId,
          messageId: playerRef.messageId,
          durationSeconds: null,
          route: playerRef.route,
        },
        minimizable: false,
      }),
    );

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
      const result = await open(fileIndex);
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
        wrap.innerHTML = '<p class="hint" style="margin:0">P2P desligado neste servidor (<code>TORRENT_ENABLED=false</code>).</p>';
        return;
      }
      if (opts.autoStart) void start();
      else idle();
    })
    .catch(() => {
      if (state.disposed) return;
      if (opts.autoStart) void start();
      else idle();
    });

  return wrap;
};
