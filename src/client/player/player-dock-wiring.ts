import { playbackSync } from './playback-service.ts';
import type { OverlayController } from './player-overlay-controller.ts';
import { getAutoplay, storeSpeed } from './player-prefs.ts';
import { installMediaSession } from './player-media.ts';
import { installPlayerKeyboard } from './player-keyboard.ts';
import { installDoubleTap } from './player-touch.ts';

const SAVE_EVERY_MS = 5_000;

/** O que os ouvintes do `<video>` precisam do player (estado fica em player-dock.ts). */
export interface DockWiring {
  /** Título do próximo da fila, ou null quando o atual é o último. */
  nextTitle(): string | null;
  overlays: OverlayController;
  persist(): void;
  attemptPlay(): void;
  syncControls(): void;
  syncProgress(): void;
  step(delta: number): void;
  queueEnded(): void;
  keyboardActive(): boolean;
  onError(): void;
  toggleCaptions(): void;
}

/** O `<video>` global: nasce uma vez, focável e sem tela cheia nativa no iPhone (`playsinline`). */
export const createVideoElement = (): HTMLVideoElement => {
  const el = document.createElement('video');
  el.tabIndex = 0;
  el.setAttribute('playsinline', '');
  el.setAttribute('aria-label', 'Vídeo');
  return el;
};

/** Liga os eventos do `<video>`. Uma vez só: o elemento vive a sessão toda (os botões são React). */
export const wirePlayerVideo = (el: HTMLVideoElement, api: DockWiring): void => {
  let lastSave = 0;

  el.addEventListener('timeupdate', () => {
    api.syncProgress();
    if (Date.now() - lastSave > SAVE_EVERY_MS) {
      lastSave = Date.now();
      api.persist();
    }
  });
  el.addEventListener('play', () => {
    api.overlays.clear();
    api.syncControls();
  });
  el.addEventListener('pause', () => {
    api.persist();
    void playbackSync.flush();
    api.syncControls();
  });
  el.addEventListener('ended', () => {
    api.persist();
    void playbackSync.flush();
    const next = api.nextTitle();
    if (next !== null) {
      if (getAutoplay()) api.overlays.startUpNext(next);
      api.syncControls();
      return;
    }
    // Acabou o último vídeo da fila: a tela de reprodução pode sugerir o próximo canal.
    api.syncControls();
    api.queueEnded();
  });
  // Velocidade: vale para a tecla, o botão, o menu nativo e o reset do load(); só valores válidos são gravados.
  el.addEventListener('ratechange', () => {
    storeSpeed(el.playbackRate);
    api.syncControls();
  });
  el.addEventListener('error', api.onError);
  // Volume, duração, buffer e saltos também mudam o que a barra mostra.
  for (const type of ['volumechange', 'loadedmetadata', 'durationchange', 'progress', 'seeked']) {
    el.addEventListener(type, api.syncProgress);
  }
  installDoubleTap(el);
  installPlayerKeyboard({
    video: () => el,
    active: api.keyboardActive,
    togglePlay: () => (el.paused ? api.attemptPlay() : el.pause()),
    next: () => api.step(1),
    toggleCaptions: () => api.toggleCaptions(),
  });

  window.addEventListener('pagehide', () => {
    api.persist();
    playbackSync.flushKeepalive();
  });
  // Puxa o progresso de outros aparelhos ao abrir e ao voltar para a aba.
  void playbackSync.pull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void playbackSync.pull();
  });

  installMediaSession(el, { play: api.attemptPlay, step: api.step });
  api.syncControls();
};
