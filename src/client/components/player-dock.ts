import { icon } from '../icons.ts';
import { createPlaybackStore, type ResumeMeta, resumePoint, type StoredPosition } from '../playback-store.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { formatDuration } from '../time-format.ts';

export interface DockItem {
  /** Identifica o vídeo para guardar a posição (`<canal>:<mensagem>`). */
  key: string;
  src: string;
  title: string;
  subtitle: string;
  poster: string | null;
  channelId: string;
  messageId: string;
  durationSeconds: number | null;
  /** Rota da tela onde esse vídeo toca em tamanho grande (para onde "expandir" volta). */
  route: string;
}

/**
 * O player é um único `<video>` global com dois modos: "page" (grande, dentro da tela de reprodução) e "dock"
 * (barra fixa no canto). A barra só aparece quando o usuário pede (`minimizePlayer`); sair da tela de
 * reprodução por outro caminho encerra o vídeo — mover o mesmo elemento entre os dois lugares não o reinicia.
 */
type Mode = 'hidden' | 'page' | 'dock';

const SAVE_EVERY_MS = 5_000;
const AUTOPLAY_KEY = 'nw.player.autoplay';

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
export const continueWatching = (limit?: number) => store.inProgress(limit);

const metaOf = (item: DockItem): ResumeMeta => ({ title: item.title, subtitle: item.subtitle, poster: item.poster, channelId: item.channelId, messageId: item.messageId, route: item.route });
/** Ordem em que o canal é listado e enfileirado: do mais recente ao mais antigo (padrão) ou o contrário. */
export type QueueOrder = 'newest' | 'oldest';
const ORDER_KEY = 'nw.player.order';
export const getQueueOrder = (): QueueOrder => (storage.getItem(ORDER_KEY) === 'oldest' ? 'oldest' : 'newest');
export const setQueueOrder = (order: QueueOrder): void => storage.setItem(ORDER_KEY, order);
export const getAutoplay = (): boolean => storage.getItem(AUTOPLAY_KEY) !== '0';
export const setAutoplay = (on: boolean): void => storage.setItem(AUTOPLAY_KEY, on ? '1' : '0');

let dock: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let queue: DockItem[] = [];
let index = 0;
let mode: Mode = 'hidden';
let lastSave = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const fn of listeners) fn();
};

/** Avisa quando o vídeo atual ou o modo mudam (a tela de reprodução atualiza título e lista). */
export const subscribePlayer = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const endedListeners = new Set<() => void>();

/** Avisa quando o último vídeo da fila termina. */
export const subscribeEnded = (fn: () => void): (() => void) => {
  endedListeners.add(fn);
  return () => endedListeners.delete(fn);
};

const q = <T extends HTMLElement>(sel: string): T => (dock as HTMLElement).querySelector(sel) as T;
const current = (): DockItem | undefined => queue[index];

export const getNowPlaying = (): { item: DockItem; queue: DockItem[]; index: number; mode: Mode } | null => {
  const item = current();
  return item ? { item, queue, index, mode } : null;
};

export const getVideo = (): HTMLVideoElement | null => video;

const persist = (): void => {
  const item = current();
  if (!item || !video || video.readyState < 1) return;
  store.save(item.key, video.currentTime, Number.isFinite(video.duration) ? video.duration : null, metaOf(item));
};

const syncControls = (): void => {
  if (!video || !dock) return;
  const playing = !video.paused && !video.ended;
  const toggle = q<HTMLButtonElement>('[data-act="toggle"]');
  toggle.innerHTML = icon(playing ? 'pause' : 'play');
  toggle.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
  q<HTMLButtonElement>('[data-act="prev"]').disabled = index <= 0;
  q<HTMLButtonElement>('[data-act="next"]').disabled = index >= queue.length - 1;
};

const syncProgress = (): void => {
  if (!video || !dock) return;
  const d = Number.isFinite(video.duration) ? video.duration : 0;
  q<HTMLInputElement>('.dock-seek').value = d ? String(Math.round((video.currentTime / d) * 1000)) : '0';
  q('.dock-time').textContent = `${formatDuration(Math.floor(video.currentTime)) ?? '0:00'}${d ? ` / ${formatDuration(Math.floor(d))}` : ''}`;
};

const setMode = (next: Mode, stage?: HTMLElement): void => {
  if (!dock || !video) return;
  mode = next;
  if (next === 'page' && stage) {
    stage.appendChild(video);
    video.controls = true;
  } else {
    q('.dock-video').appendChild(video);
    video.controls = false;
  }
  dock.hidden = next !== 'dock';
  document.body.classList.toggle('has-dock', next === 'dock');
  if (next === 'dock') {
    syncControls();
    syncProgress();
  }
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
  syncControls();
  syncProgress();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.subtitle, artwork: item.poster ? [{ src: item.poster }] : [] });
  }
  emit();
};

/** Encerra o vídeo e guarda a posição. */
export const stopPlayer = (): void => {
  persist();
  video?.pause();
  video?.removeAttribute('src');
  video?.load();
  queue = [];
  index = 0;
  setMode('hidden');
  emit();
};

/** Antes de trocar a tela: tira o `<video>` da view que vai ser descartada (um nó fora do documento pausaria). */
export const parkPlayer = (): void => {
  if (mode === 'page' && dock && video) q('.dock-video').appendChild(video);
};

/** Chamado ao sair da tela de reprodução: só encerra se o vídeo ainda estiver "na tela" (não minimizado). */
export const stopIfOnPage = (): void => {
  if (mode === 'page') stopPlayer();
};

/** Mostra `items[start]` grande dentro de `stage`. Se já é o vídeo em reprodução, só o reposiciona (sem reiniciar). */
export const showInPage = (items: DockItem[], start: number, stage: HTMLElement): void => {
  const target = items[start];
  if (!target || !dock) return;
  const alreadyPlaying = current()?.key === target.key && !!video?.getAttribute('src');
  queue = items;
  index = start;
  setMode('page', stage);
  if (alreadyPlaying) {
    syncControls();
    emit();
  } else load(start);
};

/** Botão "minimizar": o vídeo continua tocando, agora na barra fixa. */
export const minimizePlayer = (): void => {
  if (mode === 'page' && current()) setMode('dock');
  emit();
};

export const playIndex = (i: number): void => {
  if (i >= 0 && i < queue.length) load(i);
};

const step = (delta: number): void => playIndex(index + delta);

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
        <button type="button" data-act="expand" aria-label="Abrir em tela cheia">${icon('expand')}</button>
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
    if (index < queue.length - 1) {
      if (getAutoplay()) step(1);
      else syncControls();
      return;
    }
    // Acabou o último vídeo da fila: a tela de reprodução pode sugerir o próximo canal.
    syncControls();
    for (const fn of endedListeners) fn();
  });
  el.addEventListener('error', onVideoError);

  dock.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    const item = current();
    if (act === 'toggle') {
      if (el.paused) void el.play();
      else el.pause();
    } else if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'close') stopPlayer();
    else if ((act === 'expand' || target.closest('.dock-title')) && item) navigate(item.route);
  });
  q<HTMLInputElement>('.dock-seek').addEventListener('input', (e) => {
    const d = el.duration;
    if (d && Number.isFinite(d)) el.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * d;
  });
  window.addEventListener('pagehide', persist);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => void el.play());
    navigator.mediaSession.setActionHandler('pause', () => el.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  }
};
