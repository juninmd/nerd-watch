import { icon } from '../icons.ts';
import { formatDuration } from '../time-format.ts';
import { syncMediaPosition } from './player-media.ts';

/** Pintura da barra fixa a partir do estado do `<video>` (sem decidir nada: quem chama passa os valores). */

const q = <T extends HTMLElement>(dock: HTMLElement, sel: string): T => dock.querySelector(sel) as T;

export const paintControls = (dock: HTMLElement, video: HTMLVideoElement, canPrev: boolean, canNext: boolean): void => {
  const playing = !video.paused && !video.ended;
  const toggle = q<HTMLButtonElement>(dock, '[data-act="toggle"]');
  toggle.innerHTML = icon(playing ? 'pause' : 'play');
  toggle.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
  q<HTMLButtonElement>(dock, '[data-act="prev"]').disabled = !canPrev;
  q<HTMLButtonElement>(dock, '[data-act="next"]').disabled = !canNext;
};

export const paintProgress = (dock: HTMLElement, video: HTMLVideoElement): void => {
  const d = Number.isFinite(video.duration) ? video.duration : 0;
  q<HTMLInputElement>(dock, '.dock-seek').value = d ? String(Math.round((video.currentTime / d) * 1000)) : '0';
  q(dock, '.dock-time').textContent =
    `${formatDuration(Math.floor(video.currentTime)) ?? '0:00'}${d ? ` / ${formatDuration(Math.floor(d))}` : ''}`;
  syncMediaPosition(video);
};

/** Botão de velocidade: "1.25x" com o nome completo para leitor de tela. */
export const paintSpeed = (dock: HTMLElement, video: HTMLVideoElement): void => {
  const label = `${video.playbackRate}x`;
  const btn = q<HTMLButtonElement>(dock, '[data-act="speed"]');
  btn.textContent = label;
  btn.setAttribute('aria-label', `Velocidade de reprodução: ${label}. Alterar`);
};
