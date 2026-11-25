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
import { canCastItem, castSeekTarget, resumeAfterCast } from './player-cast-model.ts';
import type { DockItem } from './player-dock.ts';
import { bumpPlayerUi } from './player-ui-store.ts';

const POLL_MS = 3000;
export const CAST_SEEK_STEP_S = 10;

type RemotePlaybackLike = { prompt(): Promise<void> };

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

/** O que o diálogo de transmissão desenha (player-cast-dialog.tsx). */
export interface CastState {
  item: DockItem | undefined;
  interfaces: LanInterfaceDto[];
  selectedHost: string;
  devices: CastDeviceDto[];
  scanning: boolean;
  busy: boolean;
  errorMsg: string;
  session: CastSessionDto | null;
  playback: CastPlaybackDto | null;
  hasNative: boolean;
}

export interface CastController {
  open(): void;
  isActive(): boolean;
  stop(): Promise<void>;
  state(): CastState;
  /** O diálogo fechou: para o polling do controle remoto. */
  closed(): void;
  scan(): Promise<void>;
  launch(deviceId?: string): Promise<void>;
  play(): void;
  pause(): void;
  seekBy(delta: number): void;
  seekRatio(ratio: number): void;
  setHost(host: string): void;
  copy(which: 'watch' | 'media'): void;
  native(): void;
}

export interface CastHost {
  item(): DockItem | undefined;
  video(): HTMLVideoElement | null;
  onStateChange(): void;
  /** Abre o diálogo (React, via camada de overlays); devolve como fechá-lo. */
  showDialog(controller: CastController): () => void;
}

export const createCastController = (host: CastHost): CastController => {
  let closeDialog: (() => void) | null = null;
  let interfaces: LanInterfaceDto[] = [];
  let selectedHost = '';
  let devices: CastDeviceDto[] = [];
  let scanning = false;
  let busy = false;
  let errorMsg = '';
  let session: CastSessionDto | null = null;
  let playback: CastPlaybackDto | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let scanSeq = 0;
  let launchSeq = 0;

  const paint = bumpPlayerUi;

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
      if (!closeDialog || session?.id !== id) return stopPolling();
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

  const scan = async () => {
    const seq = ++scanSeq;
    scanning = true;
    errorMsg = '';
    paint();
    try {
      const res = await discoverCastDevices();
      if (seq !== scanSeq) return;
      interfaces = res.interfaces;
      if (!selectedHost || !interfaces.some((i) => i.address === selectedHost)) {
        selectedHost = res.defaultHost ?? '';
      }
      devices = res.devices;
    } catch (err) {
      if (seq !== scanSeq) return;
      errorMsg = err instanceof Error ? err.message : 'não foi possível buscar TVs na rede';
    } finally {
      if (seq === scanSeq) {
        scanning = false;
        paint();
      }
    }
  };

  const launch = async (deviceId?: string) => {
    const item = host.item();
    const video = host.video();
    if (!item || !canCastItem(item)) return;
    const seq = ++launchSeq;
    busy = true;
    errorMsg = '';
    paint();
    try {
      if (session) await stopCastSession(session.id).catch(() => {});
      if (seq !== launchSeq) return;
      const subtitleVtt = await readActiveSubtitleVtt(video);
      if (seq !== launchSeq) return;
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
      // Se o usuário parou ou trocou de transmissão enquanto criava a sessão, encerra a sessão órfã.
      if (seq !== launchSeq) {
        void stopCastSession(res.session.id).catch(() => {});
        return;
      }
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
      if (seq !== launchSeq) return;
      errorMsg = err instanceof Error ? err.message : 'falha ao iniciar transmissão';
    } finally {
      if (seq === launchSeq) {
        busy = false;
        paint();
      }
    }
  };

  const sendControl = async (action: 'play' | 'pause' | 'seek', seconds?: number) => {
    if (!session?.device) return;
    const targetId = session.id;
    busy = true;
    errorMsg = '';
    paint();
    try {
      const res = await controlCastSession(
        targetId,
        action === 'seek' ? { action: 'seek', seconds: seconds ?? 0 } : { action },
      );
      if (session?.id === targetId && res.playback) playback = res.playback;
    } catch (err) {
      if (session?.id === targetId) errorMsg = err instanceof Error ? err.message : 'falha ao controlar a TV';
    } finally {
      busy = false;
      paint();
    }
  };

  const stop = async (): Promise<void> => {
    launchSeq++;
    busy = false;
    stopPolling();
    const active = session;
    const resumeAt = active?.device ? resumeAfterCast(playback) : null;
    session = null;
    playback = null;
    const video = host.video();
    if (video && resumeAt !== null) video.currentTime = resumeAt;
    host.onStateChange();
    if (active) await stopCastSession(active.id).catch(() => {});
    paint();
  };

  const controller: CastController = {
    open() {
      if (!canCastItem(host.item())) {
        showToast('Este vídeo usa player externo e não pode ser transmitido pela rede local');
        return;
      }
      errorMsg = '';
      if (!closeDialog) closeDialog = host.showDialog(controller);
      paint();
      if (session?.device) startPolling();
      void scan();
    },
    isActive: () => session !== null,
    stop,
    state: () => ({
      item: host.item(),
      interfaces,
      selectedHost,
      devices,
      scanning,
      busy,
      errorMsg,
      session,
      playback,
      hasNative: Boolean(nativeRemote(host.video())),
    }),
    closed() {
      closeDialog?.();
      closeDialog = null;
      stopPolling();
    },
    scan,
    launch,
    play: () => void sendControl('play'),
    pause: () => void sendControl('pause'),
    seekBy: (delta) =>
      void sendControl(
        'seek',
        castSeekTarget(playback?.positionSeconds ?? 0, delta, playback?.durationSeconds ?? null),
      ),
    seekRatio: (ratio) => {
      if (playback?.durationSeconds) void sendControl('seek', Math.floor(ratio * playback.durationSeconds));
    },
    setHost: (next) => {
      selectedHost = next;
      paint();
    },
    copy: (which) => {
      if (!session) return;
      if (which === 'watch') copyText(session.watchUrl, 'Link da TV');
      else copyText(session.mediaUrl, 'Link do vídeo');
    },
    native: () => {
      void nativeRemote(host.video())
        ?.prompt()
        .catch(() => showToast('Nenhum dispositivo AirPlay/Chromecast disponível neste navegador'));
    },
  };
  return controller;
};
