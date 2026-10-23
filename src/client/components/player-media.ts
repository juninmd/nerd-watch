import { positionState, seekToTarget, sessionSeekTarget } from '../player-session.ts';
import type { DockItem } from './player-dock.ts';

/** Liga o vídeo à Media Session (tela de bloqueio, fones, teclas multimídia). Ações não suportadas viram TypeError. */
export const installMediaSession = (
  el: HTMLVideoElement,
  actions: { play(): void; step(delta: number): void },
): void => {
  if (!('mediaSession' in navigator)) return;
  const seekTo = (time: number | null) => {
    if (time !== null) el.currentTime = time;
  };
  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => actions.play()],
    ['pause', () => el.pause()],
    ['previoustrack', () => actions.step(-1)],
    ['nexttrack', () => actions.step(1)],
    ['seekbackward', (d) => seekTo(sessionSeekTarget('seekbackward', d.seekOffset, el.currentTime, el.duration))],
    ['seekforward', (d) => seekTo(sessionSeekTarget('seekforward', d.seekOffset, el.currentTime, el.duration))],
    ['seekto', (d) => seekTo(seekToTarget(d.seekTime, el.duration))],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (err) {
      // Navegador sem essa ação lança TypeError; qualquer outro erro é bug e segue.
      if (!(err instanceof TypeError)) throw err;
    }
  }
};

/** Barra de posição na tela de bloqueio. Sem duração finita (ao vivo) não há barra: não chama a API. */
export const syncMediaPosition = (el: HTMLVideoElement): void => {
  if (!('mediaSession' in navigator)) return;
  const state = positionState({ duration: el.duration, currentTime: el.currentTime, playbackRate: el.playbackRate });
  if (state && typeof navigator.mediaSession.setPositionState === 'function')
    navigator.mediaSession.setPositionState(state);
};

export const setMediaMetadata = (item: DockItem): void => {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.title,
    artist: item.subtitle,
    artwork: item.poster ? [{ src: item.poster }] : [],
  });
};
