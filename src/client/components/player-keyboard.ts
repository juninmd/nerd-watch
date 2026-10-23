import { keyAllowed, type PlayerAction, playerKeyAction, targetKind } from '../player-keys.ts';
import { nextSpeed, percentTarget, seekTarget, volumeTarget } from '../player-seek.ts';

export interface PlayerKeyContext {
  video(): HTMLVideoElement | null;
  /** Foco dentro do player, ou tela de reprodução sem foco em campo. */
  active(): boolean;
  togglePlay(): void;
  next(): void;
  /** Tecla "c": liga ou desliga a legenda (escolha e busca ficam com o controlador de legendas). */
  toggleCaptions(): void;
}

/** Janela em que a tecla "c" logo depois de "g" é o atalho "g c" (Conexões), não legendas. Mesmo tempo de shortcuts.ts. */
const G_PREFIX_MS = 1200;

export const seekVideo = (v: HTMLVideoElement, seconds: number): void => {
  const t = seekTarget(v.currentTime, seconds, v.duration);
  if (t !== null) v.currentTime = t;
};

/** Tela cheia no palco inteiro quando existe: é ele que carrega a barra de controles própria. */
const toggleFullscreen = (v: HTMLVideoElement): void => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void (v.closest<HTMLElement>('.watch-stage') ?? v).requestFullscreen?.();
};

const run = (v: HTMLVideoElement, action: PlayerAction, ctx: PlayerKeyContext): void => {
  switch (action.kind) {
    case 'toggle':
      ctx.togglePlay();
      break;
    case 'seekBy':
      seekVideo(v, action.seconds);
      break;
    case 'seekPercent': {
      const t = percentTarget(action.digit, v.duration);
      if (t !== null) v.currentTime = t;
      break;
    }
    case 'volumeBy': {
      const vol = volumeTarget(v.volume, action.delta);
      if (vol !== null) v.volume = vol;
      if (action.delta > 0) v.muted = false;
      break;
    }
    case 'mute':
      v.muted = !v.muted;
      break;
    case 'fullscreen':
      toggleFullscreen(v);
      break;
    case 'captions':
      ctx.toggleCaptions();
      break;
    // A troca de velocidade passa pelo evento `ratechange`, que é quem grava a preferência.
    case 'speedBy':
      v.playbackRate = nextSpeed(v.playbackRate, action.dir);
      break;
    case 'next':
      ctx.next();
      break;
  }
};

/** Teclas do player (padrão YouTube). Ignora digitação, diálogos abertos e teclas já tratadas por outro ouvinte. */
export const installPlayerKeyboard = (ctx: PlayerKeyContext): void => {
  let lastG = Number.NEGATIVE_INFINITY;
  document.addEventListener('keydown', (e) => {
    const now = Date.now();
    const afterG = now - lastG <= G_PREFIX_MS;
    lastG = e.key === 'g' ? now : Number.NEGATIVE_INFINITY;
    if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
    const video = ctx.video();
    if (!video || !ctx.active()) return;
    const target = e.target as HTMLElement;
    const kind = targetKind(
      target.tagName,
      target instanceof HTMLInputElement ? target.type : null,
      target.isContentEditable,
    );
    if (!keyAllowed(kind, e.key)) return;
    const action = playerKeyAction(e);
    if (!action || (action.kind === 'captions' && afterG)) return;
    e.preventDefault();
    run(video, action, ctx);
  });
};
