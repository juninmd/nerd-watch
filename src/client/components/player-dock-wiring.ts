import { navigate } from '../router.ts';
import { playbackSync } from '../playback-service.ts';
import { MAX_SPEED, MIN_SPEED, nextSpeed, SEEK_SECONDS } from '../player-seek.ts';
import type { DockItem } from './player-dock.ts';
import type { OverlayController } from './player-overlay-controller.ts';
import { getAutoplay, storeSpeed } from './player-prefs.ts';
import { installMediaSession } from './player-media.ts';
import { installPlayerKeyboard, seekVideo } from './player-keyboard.ts';
import { installDoubleTap } from './player-touch.ts';

const SAVE_EVERY_MS = 5_000;

/** O que os ouvintes do DOM precisam do player (estado fica em player-dock.ts). */
export interface DockWiring {
  item(): DockItem | undefined;
  /** Título do próximo da fila, ou null quando o atual é o último. */
  nextTitle(): string | null;
  overlays: OverlayController;
  persist(): void;
  attemptPlay(): void;
  syncControls(): void;
  syncProgress(): void;
  syncSpeed(): void;
  step(delta: number): void;
  stop(): void;
  queueEnded(): void;
  keyboardActive(): boolean;
  onError(): void;
}

/** Liga os eventos do `<video>` e da barra fixa. Uma vez só: o elemento e a barra vivem a sessão toda. */
export const wirePlayerDock = (dock: HTMLElement, el: HTMLVideoElement, api: DockWiring): void => {
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
    api.syncSpeed();
  });
  el.addEventListener('error', api.onError);
  installDoubleTap(el);
  installPlayerKeyboard({
    video: () => el,
    active: api.keyboardActive,
    togglePlay: () => (el.paused ? api.attemptPlay() : el.pause()),
    next: () => api.step(1),
  });

  dock.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    const item = api.item();
    if (act === 'toggle') {
      if (el.paused) api.attemptPlay();
      else el.pause();
    } else if (act === 'prev') api.step(-1);
    else if (act === 'next') api.step(1);
    else if (act === 'back') seekVideo(el, -SEEK_SECONDS);
    else if (act === 'fwd') seekVideo(el, SEEK_SECONDS);
    else if (act === 'speed')
      el.playbackRate = el.playbackRate >= MAX_SPEED ? MIN_SPEED : nextSpeed(el.playbackRate, 1);
    else if (act === 'close') api.stop();
    else if ((act === 'expand' || target.closest('.dock-title')) && item) navigate(item.route);
  });
  (dock.querySelector('.dock-seek') as HTMLInputElement).addEventListener('input', (e) => {
    const d = el.duration;
    if (d && Number.isFinite(d)) el.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * d;
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
  api.syncSpeed();
};
