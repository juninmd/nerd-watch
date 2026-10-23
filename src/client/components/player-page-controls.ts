import { icon } from '../icons.ts';
import { progressFraction, SEEK_SECONDS, SPEED_STEPS } from '../player-seek.ts';
import { formatDuration } from '../time-format.ts';
import { seekVideo } from './player-keyboard.ts';

/** Controles da tela de reprodução (palco grande), no lugar da barra nativa do navegador. */
export interface PageControlsApi {
  canPrev(): boolean;
  canNext(): boolean;
  togglePlay(): void;
  step(delta: number): void;
}

export interface PageControls {
  repaint(): void;
  destroy(): void;
}

const IDLE_MS = 2800;
const SEEK_STEPS = 1000;

const MARKUP = `
  <div class="pc-bar">
    <input class="pc-seek" type="range" min="0" max="${SEEK_STEPS}" value="0" aria-label="Posição do vídeo" />
    <div class="pc-row">
      <button type="button" data-act="prev" aria-label="Vídeo anterior">${icon('skipPrev')}</button>
      <button type="button" data-act="toggle" aria-label="Reproduzir">${icon('play')}</button>
      <button type="button" data-act="next" aria-label="Próximo vídeo">${icon('skipNext')}</button>
      <button type="button" data-act="back" class="pc-seekbtn" aria-label="Voltar ${SEEK_SECONDS} segundos">${icon('replay10')}</button>
      <button type="button" data-act="fwd" class="pc-seekbtn" aria-label="Avançar ${SEEK_SECONDS} segundos">${icon('forward10')}</button>
      <span class="pc-volume">
        <button type="button" data-act="mute" aria-label="Silenciar">${icon('volume')}</button>
        <input class="pc-vol" type="range" min="0" max="100" value="100" aria-label="Volume" />
      </span>
      <span class="pc-time" aria-hidden="true">0:00</span>
      <span class="pc-spacer"></span>
      <span class="pc-speedwrap">
        <button type="button" data-act="speed" class="pc-speed" aria-haspopup="true" aria-expanded="false" aria-label="Velocidade de reprodução: 1x">1x</button>
        <div class="pc-menu" role="menu" hidden>
          ${SPEED_STEPS.map((s) => `<button type="button" role="menuitemradio" data-rate="${s}" aria-checked="false">${s === 1 ? 'Normal' : `${s}x`}</button>`).join('')}
        </div>
      </span>
      <button type="button" data-act="pip" aria-label="Picture-in-picture">${icon('pip')}</button>
      <button type="button" data-act="fullscreen" aria-label="Tela cheia">${icon('expand')}</button>
    </div>
  </div>`;

const bufferedEnd = (v: HTMLVideoElement): number => {
  for (let i = 0; i < v.buffered.length; i += 1) {
    if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) return v.buffered.end(i);
  }
  return v.currentTime;
};

const toggleStageFullscreen = (stage: HTMLElement): void => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.requestFullscreen?.();
};

/**
 * Monta a barra dentro do palco, por cima do `<video>`. Mouse parado esconde a barra enquanto toca; qualquer movimento,
 * foco ou pausa traz de volta. O elemento nasce e morre com o palco: `destroy` solta todos os ouvintes de uma vez.
 */
export const mountPageControls = (stage: HTMLElement, video: HTMLVideoElement, api: PageControlsApi): PageControls => {
  const abort = new AbortController();
  const { signal } = abort;
  const root = document.createElement('div');
  root.className = 'pc';
  root.innerHTML = MARKUP;
  stage.appendChild(root);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const seek = q<HTMLInputElement>('.pc-seek');
  const vol = q<HTMLInputElement>('.pc-vol');
  const menu = q('.pc-menu');
  const speedBtn = q<HTMLButtonElement>('[data-act="speed"]');
  let dragging = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const setIcon = (act: string, name: Parameters<typeof icon>[0], label: string): void => {
    const btn = q<HTMLButtonElement>(`[data-act="${act}"]`);
    btn.innerHTML = icon(name);
    btn.setAttribute('aria-label', label);
  };

  const closeMenu = (): void => {
    menu.hidden = true;
    speedBtn.setAttribute('aria-expanded', 'false');
  };

  const wake = (): void => {
    root.classList.remove('pc-idle');
    stage.classList.remove('pc-hide-cursor');
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (video.paused || root.contains(document.activeElement) || !menu.hidden) return;
      root.classList.add('pc-idle');
      stage.classList.add('pc-hide-cursor');
    }, IDLE_MS);
  };

  const repaint = (): void => {
    const playing = !video.paused && !video.ended;
    setIcon('toggle', playing ? 'pause' : 'play', playing ? 'Pausar' : 'Reproduzir');
    q<HTMLButtonElement>('[data-act="prev"]').disabled = !api.canPrev();
    q<HTMLButtonElement>('[data-act="next"]').disabled = !api.canNext();

    const d = Number.isFinite(video.duration) ? video.duration : 0;
    const played = progressFraction(video.currentTime, d);
    if (!dragging) seek.value = String(Math.round(played * SEEK_STEPS));
    seek.style.setProperty('--played', `${played * 100}%`);
    seek.style.setProperty('--buffered', `${progressFraction(bufferedEnd(video), d) * 100}%`);
    const now = formatDuration(Math.floor(video.currentTime)) ?? '0:00';
    const total = d ? formatDuration(Math.floor(d)) : null;
    q('.pc-time').textContent = total ? `${now} / ${total}` : now;
    seek.setAttribute('aria-valuetext', total ? `${now} de ${total}` : now);

    const silent = video.muted || video.volume === 0;
    setIcon('mute', silent ? 'volumeMute' : 'volume', silent ? 'Ativar som' : 'Silenciar');
    vol.value = String(Math.round((silent ? 0 : video.volume) * 100));
    vol.style.setProperty('--played', `${vol.value}%`);

    const rate = video.playbackRate;
    speedBtn.textContent = `${rate}x`;
    speedBtn.setAttribute('aria-label', `Velocidade de reprodução: ${rate}x`);
    for (const item of menu.querySelectorAll<HTMLElement>('[data-rate]')) {
      item.setAttribute('aria-checked', String(Number(item.dataset.rate) === rate));
    }
    const full = document.fullscreenElement === stage;
    setIcon('fullscreen', full ? 'minimize' : 'expand', full ? 'Sair da tela cheia' : 'Tela cheia');
    if (!playing) wake();
  };

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const rate = target.closest<HTMLElement>('[data-rate]')?.dataset.rate;
    if (rate) {
      video.playbackRate = Number(rate);
      closeMenu();
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act !== 'speed') closeMenu();
    if (act === 'toggle') api.togglePlay();
    else if (act === 'prev') api.step(-1);
    else if (act === 'next') api.step(1);
    else if (act === 'back') seekVideo(video, -SEEK_SECONDS);
    else if (act === 'fwd') seekVideo(video, SEEK_SECONDS);
    else if (act === 'mute') video.muted = !video.muted;
    else if (act === 'fullscreen') toggleStageFullscreen(stage);
    else if (act === 'pip') {
      if (document.pictureInPictureElement) void document.exitPictureInPicture();
      else void video.requestPictureInPicture?.();
    } else if (act === 'speed') {
      menu.hidden = !menu.hidden;
      speedBtn.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    }
  });

  seek.addEventListener('pointerdown', () => {
    dragging = true;
  });
  seek.addEventListener('input', () => {
    const d = video.duration;
    if (d && Number.isFinite(d)) video.currentTime = (Number(seek.value) / SEEK_STEPS) * d;
  });
  seek.addEventListener('change', () => {
    dragging = false;
    repaint();
  });
  vol.addEventListener('input', () => {
    video.volume = Number(vol.value) / 100;
    video.muted = video.volume === 0;
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeMenu();
    speedBtn.focus();
  });

  // Clique no vídeo: mouse alterna play/pause; toque só mostra a barra (o duplo toque é o salto de 10 s).
  video.addEventListener(
    'click',
    (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return wake();
      api.togglePlay();
    },
    { signal },
  );
  // No toque, o duplo toque é salto de 10 s: tela cheia por duplo clique só com mouse.
  video.addEventListener('dblclick', () => matchMedia('(pointer: fine)').matches && toggleStageFullscreen(stage), { signal });
  for (const type of ['volumechange', 'loadedmetadata', 'durationchange', 'progress', 'ratechange', 'seeked']) {
    video.addEventListener(type, repaint, { signal });
  }
  document.addEventListener('fullscreenchange', repaint, { signal });
  for (const type of ['pointermove', 'pointerdown', 'focusin', 'keydown']) {
    stage.addEventListener(type, wake, { signal });
  }
  stage.addEventListener('pointerleave', () => !video.paused && root.classList.add('pc-idle'), { signal });
  document.addEventListener('pointerdown', (e) => !root.contains(e.target as Node) && closeMenu(), { signal });
  if (!document.pictureInPictureEnabled) q('[data-act="pip"]').hidden = true;

  repaint();
  wake();
  return {
    repaint,
    destroy: () => {
      abort.abort();
      if (idleTimer) clearTimeout(idleTimer);
      stage.classList.remove('pc-hide-cursor');
      root.remove();
    },
  };
};
