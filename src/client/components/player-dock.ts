import { icon } from '../icons.ts';
import { createPlaybackStore, resumePoint, type StoredPosition } from '../playback-store.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { formatDuration } from '../time-format.ts';

export interface DockItem {
  /** Identifica o vídeo para guardar a posição (ex.: `<canal>:<mensagem>`). */
  key: string;
  src: string;
  title: string;
  subtitle: string;
  poster: string | null;
  /** Rota do app para onde o título do player leva. */
  href: string;
}

const SAVE_EVERY_MS = 5_000;

const storage = {
  getItem: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // armazenamento bloqueado
    }
  },
};
const store = createPlaybackStore(storage);

export const savedPosition = (key: string): StoredPosition | undefined => store.get(key);

let dock: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let queue: DockItem[] = [];
let index = 0;
let lastSave = 0;

const q = <T extends HTMLElement>(sel: string): T => (dock as HTMLElement).querySelector(sel) as T;
const current = (): DockItem | undefined => queue[index];

const persist = (): void => {
  const item = current();
  if (!item || !video || video.readyState < 1) return;
  store.save(item.key, video.currentTime, Number.isFinite(video.duration) ? video.duration : null);
};

const syncControls = (): void => {
  if (!video) return;
  const playing = !video.paused && !video.ended;
  const toggle = q<HTMLButtonElement>('[data-act="toggle"]');
  toggle.innerHTML = icon(playing ? 'pause' : 'play');
  toggle.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
  q<HTMLButtonElement>('[data-act="prev"]').disabled = index <= 0;
  q<HTMLButtonElement>('[data-act="next"]').disabled = index >= queue.length - 1;
};

const syncProgress = (): void => {
  if (!video) return;
  const d = Number.isFinite(video.duration) ? video.duration : 0;
  q<HTMLInputElement>('.dock-seek').value = d ? String(Math.round((video.currentTime / d) * 1000)) : '0';
  q('.dock-time').textContent = `${formatDuration(Math.floor(video.currentTime)) ?? '0:00'}${d ? ` / ${formatDuration(Math.floor(d))}` : ''}`;
};

const setTheater = (on: boolean, moveFocus = true): void => {
  if (!dock || !video) return;
  dock.classList.toggle('theater', on);
  video.controls = on;
  const btn = q<HTMLButtonElement>('[data-act="theater"]');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Sair do modo teatro' : 'Modo teatro');
  if (moveFocus) btn.focus();
};

const load = (i: number): void => {
  const item = queue[i];
  const el = video;
  if (!item || !dock || !el) return;
  persist();
  index = i;
  const resumeAt = resumePoint(store.get(item.key));
  el.poster = item.poster ?? '';
  el.src = item.src;
  el.addEventListener(
    'loadedmetadata',
    () => {
      if (resumeAt !== null && resumeAt < el.duration) el.currentTime = resumeAt;
    },
    { once: true },
  );
  el.play().catch(() => syncControls());
  q('.dock-title').textContent = item.title;
  q('.dock-sub').textContent = resumeAt !== null ? `${item.subtitle} · retomando de ${formatDuration(resumeAt)}` : item.subtitle;
  dock.hidden = false;
  document.body.classList.add('has-dock');
  syncControls();
  syncProgress();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.subtitle, artwork: item.poster ? [{ src: item.poster }] : [] });
  }
};

const stop = (): void => {
  persist();
  video?.pause();
  video?.removeAttribute('src');
  video?.load();
  if (dock) dock.hidden = true;
  setTheater(false, false);
  document.body.classList.remove('has-dock');
  queue = [];
};

const step = (delta: number): void => {
  const next = index + delta;
  if (next >= 0 && next < queue.length) load(next);
};

/** Toca `items[start]` e deixa o resto como fila (o fim de um vídeo abre o próximo). */
export const playInDock = (items: DockItem[], start = 0): void => {
  if (!dock || items.length === 0) return;
  queue = items;
  load(start);
};

const onVideoError = (): void => {
  const item = current();
  if (!item) return;
  // Range mínimo: sem isso, no modo conta pessoal um erro dispararia o download completo só pra ler o corpo do erro.
  fetch(item.src, { headers: { Range: 'bytes=0-0' } })
    .then((r) => r.json())
    .then((body) => showToast(body.error ?? 'não foi possível reproduzir esse vídeo'))
    .catch(() => showToast('não foi possível reproduzir esse vídeo'));
};

/** Monta o player global uma vez no shell; ele sobrevive à troca de telas. */
export const mountPlayerDock = (host: HTMLElement): void => {
  host.innerHTML = `
    <section class="dock" aria-label="Player de vídeo" hidden>
      <div class="dock-video"><video playsinline></video></div>
      <div class="dock-info" aria-live="polite"><button class="dock-title" type="button"></button><small class="dock-sub"></small></div>
      <div class="dock-controls">
        <button type="button" data-act="prev" aria-label="Vídeo anterior">${icon('skipPrev')}</button>
        <button type="button" data-act="toggle" aria-label="Pausar">${icon('pause')}</button>
        <button type="button" data-act="next" aria-label="Próximo vídeo">${icon('skipNext')}</button>
      </div>
      <input class="dock-seek" type="range" min="0" max="1000" value="0" aria-label="Posição do vídeo" />
      <span class="dock-time" aria-hidden="true"></span>
      <div class="dock-end">
        <button type="button" data-act="theater" aria-pressed="false" aria-label="Modo teatro">${icon('expand')}</button>
        <button type="button" data-act="close" aria-label="Fechar player">${icon('x')}</button>
      </div>
    </section>`;
  dock = host.querySelector('.dock') as HTMLElement;
  const el = dock.querySelector('video') as HTMLVideoElement;
  video = el;

  el.addEventListener('timeupdate', () => {
    syncProgress();
    if (Date.now() - lastSave > SAVE_EVERY_MS) {
      lastSave = Date.now();
      persist();
    }
  });
  el.addEventListener('play', syncControls);
  el.addEventListener('pause', () => {
    persist();
    syncControls();
  });
  el.addEventListener('ended', () => {
    persist();
    if (index < queue.length - 1) step(1);
    else syncControls();
  });
  el.addEventListener('error', onVideoError);

  dock.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'toggle') {
      if (el.paused) void el.play();
      else el.pause();
    } else if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'theater') setTheater(!dock?.classList.contains('theater'));
    else if (act === 'close') stop();
    else if (target.closest('.dock-title')) {
      const href = current()?.href;
      if (href) navigate(href);
    }
  });
  q<HTMLInputElement>('.dock-seek').addEventListener('input', (e) => {
    const d = el.duration;
    if (d && Number.isFinite(d)) el.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * d;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dock?.classList.contains('theater')) setTheater(false);
  });
  window.addEventListener('pagehide', persist);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => void el.play());
    navigator.mediaSession.setActionHandler('pause', () => el.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  }
};
