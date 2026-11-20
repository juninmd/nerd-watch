import {
  type CastDeviceDto,
  type CastPlaybackDto,
  type CastSessionDto,
  controlCastSession,
  discoverCastDevices,
  getCastSession,
  type LanInterfaceDto,
  startCastSession,
  stopCastSession,
} from '../api/cast.ts';
import { showToast } from '../app/state.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { formatDuration } from '../ui/time-format.ts';
import { canCastItem, castSeekTarget, castStatusLabel, formatDeviceSubtitle } from './player-cast-model.ts';
import type { DockItem } from './player-dock.ts';

const POLL_MS = 3000;
const SEEK_STEP_S = 10;

interface RemotePlaybackLike {
  prompt(): Promise<void>;
}

const nativeRemote = (video: HTMLVideoElement | null): RemotePlaybackLike | null => {
  if (!video || !('remote' in video)) return null;
  const remote = (video as HTMLVideoElement & { remote?: RemotePlaybackLike }).remote;
  return remote && typeof remote.prompt === 'function' ? remote : null;
};

/** Lê o WebVTT da legenda ativa no `<video>` (se houver `<track>` ligado) para enviar junto para a TV. */
const readActiveSubtitleVtt = async (video: HTMLVideoElement | null): Promise<string | null> => {
  if (!video) return null;
  const tracks = Array.from(video.querySelectorAll('track'));
  const active = tracks.find((t) => t.track.mode === 'showing' && t.src);
  if (!active?.src) return null;
  try {
    const res = await fetch(active.src);
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim().startsWith('WEBVTT') ? text : null;
  } catch {
    return null;
  }
};

export interface CastController {
  open(): void;
  isActive(): boolean;
  stop(): Promise<void>;
}

export interface CastHost {
  item(): DockItem | undefined;
  video(): HTMLVideoElement | null;
  onStateChange(): void;
}

export const createCastController = (host: CastHost): CastController => {
  let dialog: HTMLDialogElement | null = null;
  let interfaces: LanInterfaceDto[] = [];
  let selectedHost = '';
  let devices: CastDeviceDto[] = [];
  let scanning = false;
  let busy = false;
  let errorMsg = '';
  let session: CastSessionDto | null = null;
  let playback: CastPlaybackDto | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    if (!session?.device) return;
    const id = session.id;
    pollTimer = setInterval(() => {
      if (!dialog?.open || session?.id !== id) return stopPolling();
      getCastSession(id)
        .then((res) => {
          if (session?.id !== id) return;
          playback = res.playback;
          paint();
        })
        .catch(() => {});
    }, POLL_MS);
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => showToast(`${label} copiado`))
      .catch(() => showToast('Não foi possível copiar automaticamente'));
  };

  const paintRemote = (active: CastSessionDto): string => {
    const pos = playback?.positionSeconds ?? 0;
    const dur = playback?.durationSeconds ?? 0;
    const playing = playback?.state === 'PLAYING';
    const pct = dur > 0 ? Math.min(1000, Math.round((pos / dur) * 1000)) : 0;
    const timeLabel = dur > 0 ? `${formatDuration(pos) ?? '0:00'} / ${formatDuration(dur) ?? '0:00'}` : (formatDuration(pos) ?? '0:00');
    return `
      <div class="cast-remote">
        <div class="cast-remote-head">
          <div>
            <b>${escapeHtml(active.device?.name ?? 'TV na rede local')}</b>
            <div class="cast-remote-status">${escapeHtml(castStatusLabel(playback?.state))}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-cast="stop" ${busy ? 'disabled' : ''}>${icon('stop', 'sm')} Parar</button>
        </div>
        ${
          dur > 0
            ? `<div class="cast-remote-bar">
                <input class="cast-remote-seek" type="range" min="0" max="1000" value="${pct}" aria-label="Posição na TV" />
                <span class="cast-remote-time">${escapeHtml(timeLabel)}</span>
              </div>`
            : `<div class="cast-remote-time">${escapeHtml(timeLabel)}</div>`
        }
        <div class="cast-remote-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-cast="back" aria-label="Voltar ${SEEK_STEP_S} segundos" ${busy ? 'disabled' : ''}>${icon('replay10', 'sm')} -10s</button>
          <button type="button" class="btn btn-primary btn-sm" data-cast="${playing ? 'pause' : 'play'}" ${busy ? 'disabled' : ''}>${icon(playing ? 'pause' : 'play', 'sm')} ${playing ? 'Pausar' : 'Reproduzir'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-cast="fwd" aria-label="Avançar ${SEEK_STEP_S} segundos" ${busy ? 'disabled' : ''}>${icon('forward10', 'sm')} +10s</button>
        </div>
      </div>`;
  };

  const paintQrSection = (active: CastSessionDto | null): string => {
    if (!active) {
      return `
        <div class="cast-section">
          <div class="cast-section-head"><h3>Navegador da TV ou QR Code</h3></div>
          <p class="hint" style="margin:0">Funciona em qualquer Smart TV (mesmo sem DLNA), Apple TV, Fire TV ou celular no mesmo Wi-Fi.</p>
          <button type="button" class="btn btn-ghost btn-sm" data-cast="link" ${busy ? 'disabled' : ''}>
            ${icon('monitor', 'sm')} Gerar QR Code e link na rede local
          </button>
        </div>`;
    }
    return `
      <div class="cast-section">
        <div class="cast-section-head">
          <h3>Link e QR Code na rede local</h3>
          ${!active.device ? `<button type="button" class="btn btn-ghost btn-sm" data-cast="stop" ${busy ? 'disabled' : ''}>Encerrar link</button>` : ''}
        </div>
        <div class="cast-qr-box">
          <img class="cast-qr-img" src="${escapeHtml(active.qrDataUrl)}" alt="QR Code para abrir o vídeo na TV" />
          <div class="cast-qr-info">
            <p class="cast-url">${escapeHtml(active.watchUrl)}</p>
            <div class="cast-url-actions">
              <button type="button" class="btn btn-primary btn-sm" data-cast="copy-watch">Copiar link da TV</button>
              <button type="button" class="btn btn-ghost btn-sm" data-cast="copy-media">Link direto (VLC/Kodi)</button>
            </div>
          </div>
        </div>
      </div>`;
  };

  const paint = () => {
    if (!dialog) return;
    const item = host.item();
    const ifaceSelect =
      interfaces.length > 1
        ? `<label class="cast-iface-row">Rede local:
            <select class="select input-sm" id="cast-host">
              ${interfaces.map((i) => `<option value="${escapeHtml(i.address)}"${i.address === selectedHost ? ' selected' : ''}>${escapeHtml(`${i.address} (${i.name})`)}</option>`).join('')}
            </select>
          </label>`
        : '';

    const deviceList = scanning
      ? '<p class="hint" style="margin:0">Procurando TVs na sua rede Wi-Fi…</p>'
      : devices.length === 0
        ? '<p class="hint" style="margin:0">Nenhuma TV DLNA encontrada automaticamente. Confirme se o computador e a TV estão no mesmo Wi-Fi ou use o QR Code abaixo.</p>'
        : `<div class="cast-devices">${devices
            .map(
              (dev) => `<button type="button" class="cast-device" data-device="${escapeHtml(dev.id)}" ${busy ? 'disabled' : ''}>
                <span class="cast-device-meta"><b>${escapeHtml(dev.name)}</b><small>${escapeHtml(formatDeviceSubtitle(dev))}</small></span>
                <span class="btn btn-primary btn-sm">Enviar</span>
              </button>`,
            )
            .join('')}</div>`;

    const hasNative = Boolean(nativeRemote(host.video()));

    dialog.innerHTML = `
      <div class="cast-head">
        <h2>${icon('cast', 'sm')} Enviar para a TV</h2>
        <button type="button" class="btn btn-ghost btn-sm" data-cast="close" aria-label="Fechar">${icon('x', 'sm')}</button>
      </div>
      <div class="cast-body">
        ${item ? `<p class="cast-video-title">${escapeHtml(item.title)}</p>` : ''}
        ${errorMsg ? `<p class="cast-err" role="alert">${escapeHtml(errorMsg)}</p>` : ''}
        ${ifaceSelect}
        ${session?.device ? paintRemote(session) : ''}
        <div class="cast-section">
          <div class="cast-section-head">
            <h3>TVs encontradas no Wi-Fi</h3>
            <button type="button" class="btn btn-ghost btn-sm" data-cast="rescan" ${scanning ? 'disabled' : ''}>${icon('refresh', 'sm')} Buscar</button>
          </div>
          ${deviceList}
        </div>
        ${paintQrSection(session)}
        ${
          hasNative
            ? `<div class="cast-section">
                <button type="button" class="btn btn-ghost btn-sm" data-cast="native">
                  ${icon('cast', 'sm')} Transmitir pelo navegador (AirPlay / Chromecast)
                </button>
              </div>`
            : ''
        }
      </div>`;
  };

  const scan = async () => {
    scanning = true;
    errorMsg = '';
    paint();
    try {
      const res = await discoverCastDevices();
      interfaces = res.interfaces;
      if (!selectedHost || !interfaces.some((i) => i.address === selectedHost)) {
        selectedHost = res.defaultHost ?? '';
      }
      devices = res.devices;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'não foi possível buscar TVs na rede';
    } finally {
      scanning = false;
      paint();
    }
  };

  const launch = async (deviceId?: string) => {
    const item = host.item();
    const video = host.video();
    if (!item || !canCastItem(item)) return;
    busy = true;
    errorMsg = '';
    paint();
    try {
      if (session) await stopCastSession(session.id).catch(() => {});
      const subtitleVtt = await readActiveSubtitleVtt(video);
      const startAt = video && Number.isFinite(video.currentTime) ? Math.floor(video.currentTime) : 0;
      const res = await startCastSession({
        src: item.src,
        title: item.title,
        subtitle: item.subtitle,
        poster: item.poster,
        subtitleVtt,
        startAt,
        host: selectedHost || undefined,
        deviceId,
      });
      session = res.session;
      playback = res.session.device ? { state: 'PLAYING', positionSeconds: startAt, durationSeconds: null } : null;
      if (res.session.device) {
        video?.pause();
        showToast(`Enviado para ${res.session.device.name}`);
        startPolling();
      } else {
        showToast('Link da TV pronto na rede local');
      }
      host.onStateChange();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'falha ao iniciar transmissão';
    } finally {
      busy = false;
      paint();
    }
  };

  const sendControl = async (action: 'play' | 'pause' | 'seek', seconds?: number) => {
    if (!session?.device) return;
    busy = true;
    errorMsg = '';
    paint();
    try {
      const res = await controlCastSession(
        session.id,
        action === 'seek' ? { action: 'seek', seconds: seconds ?? 0 } : { action },
      );
      if (res.playback) playback = res.playback;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'falha ao controlar a TV';
    } finally {
      busy = false;
      paint();
    }
  };

  const stop = async (): Promise<void> => {
    stopPolling();
    const active = session;
    session = null;
    playback = null;
    host.onStateChange();
    if (active) await stopCastSession(active.id).catch(() => {});
    if (dialog?.open) paint();
  };

  const ensureDialog = (): HTMLDialogElement => {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'cast-dialog';
    dialog.setAttribute('aria-label', 'Enviar vídeo para a TV');
    document.body.appendChild(dialog);

    dialog.addEventListener('close', () => stopPolling());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) return dialog?.close();
      const target = e.target as HTMLElement;
      const devBtn = target.closest<HTMLElement>('[data-device]');
      if (devBtn?.dataset.device) return void launch(devBtn.dataset.device);

      const act = target.closest<HTMLElement>('[data-cast]')?.dataset.cast;
      if (!act) return;
      if (act === 'close') dialog?.close();
      else if (act === 'rescan') void scan();
      else if (act === 'link') void launch();
      else if (act === 'stop') void stop();
      else if (act === 'play') void sendControl('play');
      else if (act === 'pause') void sendControl('pause');
      else if (act === 'back') void sendControl('seek', castSeekTarget(playback?.positionSeconds ?? 0, -SEEK_STEP_S, playback?.durationSeconds ?? null));
      else if (act === 'fwd') void sendControl('seek', castSeekTarget(playback?.positionSeconds ?? 0, SEEK_STEP_S, playback?.durationSeconds ?? null));
      else if (act === 'copy-watch' && session) copyText(session.watchUrl, 'Link da TV');
      else if (act === 'copy-media' && session) copyText(session.mediaUrl, 'Link do vídeo');
      else if (act === 'native') {
        void nativeRemote(host.video())
          ?.prompt()
          .catch(() => showToast('Nenhum dispositivo AirPlay/Chromecast disponível neste navegador'));
      }
    });

    dialog.addEventListener('change', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'cast-host') {
        selectedHost = (target as HTMLSelectElement).value;
      } else if (target.classList.contains('cast-remote-seek') && playback?.durationSeconds) {
        const ratio = Number((target as HTMLInputElement).value) / 1000;
        void sendControl('seek', Math.floor(ratio * playback.durationSeconds));
      }
    });

    return dialog;
  };

  const open = () => {
    const item = host.item();
    if (!canCastItem(item)) {
      showToast('Este vídeo usa player externo e não pode ser transmitido pela rede local');
      return;
    }
    const el = ensureDialog();
    errorMsg = '';
    if (!el.open) el.showModal();
    paint();
    if (session?.device) startPolling();
    void scan();
  };

  return {
    open,
    isActive: () => session !== null,
    stop,
  };
};
