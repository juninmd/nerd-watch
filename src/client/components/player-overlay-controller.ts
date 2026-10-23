import {
  cancelCountdown,
  type Countdown,
  startCountdown,
  tickCountdown,
  UP_NEXT_SECONDS,
} from '../player-countdown.ts';
import { type OverlayView, showTapToPlay, showUpNext } from './player-overlays.ts';

export interface OverlayController {
  /** Autoplay bloqueado pelo navegador: pede um toque do usuário. */
  askTap(): void;
  /** Contagem para o próximo vídeo; ao chegar a zero chama `onNext`. */
  startUpNext(title: string): void;
  /** Some com qualquer overlay (novo vídeo, reprodução retomada, player fechado). */
  clear(): void;
  /** Recoloca o overlay quando o palco muda de lugar (página <-> barra fixa). */
  repaint(): void;
}

interface UpNext {
  title: string;
  countdown: Countdown;
  timer: ReturnType<typeof setInterval>;
}

/** Estado dos overlays do player (toque para reproduzir e próximo vídeo). O DOM fica em player-overlays.ts. */
export const createOverlayController = (opts: {
  host(): HTMLElement | null;
  onNext(): void;
  onTap(): void;
}): OverlayController => {
  let tapPending = false;
  let upNext: UpNext | null = null;
  let view: OverlayView | null = null;

  const paint = (): void => {
    view?.remove();
    view = null;
    const host = opts.host();
    if (!host) return;
    if (upNext) {
      view = showUpNext(host, {
        title: upNext.title,
        remaining: upNext.countdown.remaining,
        onPlayNow: () => {
          stopUpNext();
          opts.onNext();
        },
        onCancel: () => {
          if (upNext) upNext.countdown = cancelCountdown(upNext.countdown);
          stopUpNext();
        },
      });
    } else if (tapPending) {
      view = showTapToPlay(host, () => {
        tapPending = false;
        paint();
        opts.onTap();
      });
    }
  };

  const stopUpNext = (): void => {
    if (upNext) clearInterval(upNext.timer);
    upNext = null;
    paint();
  };

  const tick = (): void => {
    if (!upNext) return;
    upNext.countdown = tickCountdown(upNext.countdown);
    if (upNext.countdown.status === 'done') {
      stopUpNext();
      opts.onNext();
      return;
    }
    view?.setRemaining?.(upNext.countdown.remaining);
  };

  return {
    askTap() {
      tapPending = true;
      paint();
    },
    startUpNext(title) {
      if (upNext) clearInterval(upNext.timer);
      upNext = { title, countdown: startCountdown(UP_NEXT_SECONDS), timer: setInterval(tick, 1000) };
      paint();
    },
    clear() {
      tapPending = false;
      if (upNext) clearInterval(upNext.timer);
      upNext = null;
      paint();
    },
    repaint: paint,
  };
};
