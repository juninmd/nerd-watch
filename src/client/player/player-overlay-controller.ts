import { cancelCountdown, type Countdown, startCountdown, tickCountdown, UP_NEXT_SECONDS } from './player-countdown.ts';

/** O que o palco (ou a barra fixa) desenha por cima do vídeo agora. */
type OverlayState = { kind: 'tap' } | { kind: 'upnext'; title: string; remaining: number } | null;

export interface OverlayController {
  /** Autoplay bloqueado pelo navegador: pede um toque do usuário. */
  askTap(): void;
  /** Contagem para o próximo vídeo; ao chegar a zero chama `onNext`. */
  startUpNext(title: string): void;
  /** Some com qualquer overlay (novo vídeo, reprodução retomada, player fechado). */
  clear(): void;
  state(): OverlayState;
  /** Toque no "Toque para reproduzir": é o gesto que o navegador exige. */
  tap(): void;
  playNow(): void;
  cancelUpNext(): void;
}

interface UpNext {
  title: string;
  countdown: Countdown;
  timer: ReturnType<typeof setInterval>;
}

/** Estado dos overlays do player (toque para reproduzir e próximo vídeo). O desenho fica em player-overlays.tsx. */
export const createOverlayController = (opts: {
  onChange(): void;
  onNext(): void;
  onTap(): void;
}): OverlayController => {
  let tapPending = false;
  let upNext: UpNext | null = null;

  const stopUpNext = (): void => {
    if (upNext) clearInterval(upNext.timer);
    upNext = null;
    opts.onChange();
  };

  const tick = (): void => {
    if (!upNext) return;
    upNext.countdown = tickCountdown(upNext.countdown);
    if (upNext.countdown.status === 'done') {
      stopUpNext();
      opts.onNext();
      return;
    }
    opts.onChange();
  };

  return {
    askTap() {
      tapPending = true;
      opts.onChange();
    },
    startUpNext(title) {
      if (upNext) clearInterval(upNext.timer);
      upNext = { title, countdown: startCountdown(UP_NEXT_SECONDS), timer: setInterval(tick, 1000) };
      opts.onChange();
    },
    clear() {
      tapPending = false;
      if (upNext) clearInterval(upNext.timer);
      upNext = null;
      opts.onChange();
    },
    state() {
      if (upNext) return { kind: 'upnext', title: upNext.title, remaining: upNext.countdown.remaining };
      return tapPending ? { kind: 'tap' } : null;
    },
    tap() {
      tapPending = false;
      opts.onChange();
      opts.onTap();
    },
    playNow() {
      stopUpNext();
      opts.onNext();
    },
    cancelUpNext() {
      if (upNext) upNext.countdown = cancelCountdown(upNext.countdown);
      stopUpNext();
    },
  };
};
