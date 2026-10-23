import { type ResumeMeta, resumePoint, type StoredPosition } from '../playback-store.ts';
import { playbackSync } from '../playback-service.ts';
import { isAutoplayBlocked } from '../player-session.ts';
import { showToast } from '../state.ts';
import { formatDuration } from '../time-format.ts';
import { createOverlayController } from './player-overlay-controller.ts';
import { getStoredSpeed } from './player-prefs.ts';
import { setMediaMetadata } from './player-media.ts';
import { onPlayError } from './player-error.ts';
import { handleUnplayable, prepareForItem } from '../media-fallback.ts';
import { paintControls, paintProgress, paintSpeed } from './player-dock-view.ts';
import { DOCK_MARKUP } from './player-dock-markup.ts';
import { wirePlayerDock } from './player-dock-wiring.ts';
import { clearVideo, playerKindOf } from './watch-embed.ts';

export { getAutoplay, getQueueOrder, type QueueOrder, setAutoplay, setQueueOrder } from './player-prefs.ts';

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
  /** Iframe de embed (YouTube, ou PeerTube sem arquivo direto): não passa pelo `<video>`. */
  embedUrl?: string | null;
}

/**
 * O player é um único `<video>` global com dois modos: "page" (grande, dentro da tela de reprodução) e "dock"
 * (barra fixa no canto). A barra só aparece quando o usuário pede (`minimizePlayer`); sair da tela de
 * reprodução por outro caminho encerra o vídeo — mover o mesmo elemento entre os dois lugares não o reinicia.
 */
type Mode = 'hidden' | 'page' | 'dock';

const store = playbackSync.store;

export const savedPosition = (key: string): StoredPosition | undefined => store.get(key);
export const continueWatching = (limit?: number) => store.inProgress(limit);

const metaOf = (item: DockItem): ResumeMeta => ({ title: item.title, subtitle: item.subtitle, poster: item.poster, channelId: item.channelId, messageId: item.messageId, route: item.route });

let dock: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let queue: DockItem[] = [];
let index = 0;
let mode: Mode = 'hidden';
const listeners = new Set<() => void>();

/** Toque para reproduzir (autoplay bloqueado) e contagem do próximo vídeo: ficam no palco ou na barra, conforme o modo. */
const overlays = createOverlayController({
  host: () => (mode === 'dock' ? dock : mode === 'page' ? (video?.parentElement ?? null) : null),
  onNext: () => step(1),
  onTap: () => attemptPlay(),
});

/**
 * `play()` pode ser recusado pelo navegador (autoplay com som sem gesto). A recusa vira um pedido de toque, não um
 * erro engolido. AbortError (outro `src` entrou no meio) e NotSupportedError (o evento `error` do vídeo já avisa) não
 * pedem nada.
 */
const attemptPlay = (): void => {
  video?.play().catch((err: unknown) => {
    if (isAutoplayBlocked(err)) overlays.askTap();
    syncControls();
  });
};

/** Teclas valem com o foco no player, ou na tela de reprodução sem foco em campo. Outras telas seguem normais. */
const keyboardActive = (): boolean => {
  const el = video;
  const item = current();
  if (!el || !item || playerKindOf(item) === 'embed') return false;
  const shell = mode === 'dock' ? dock : el.parentElement;
  const focus = document.activeElement;
  if (focus && shell?.contains(focus)) return true;
  return mode === 'page' && (!focus || focus === document.body) && location.hash.startsWith('#/watch/');
};

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
  if (video && dock) paintControls(dock, video, index > 0, index < queue.length - 1);
};
const syncProgress = (): void => {
  if (video && dock) paintProgress(dock, video);
};
const syncSpeed = (): void => {
  if (video && dock) paintSpeed(dock, video);
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
  overlays.repaint();
};

const load = (i: number): void => {
  const item = queue[i];
  const el = video;
  if (!item || !dock || !el) return;
  persist();
  index = i;
  overlays.clear();
  const resumeAt = resumePoint(store.get(item.key));
  // Trocar o src volta a taxa para a padrão do elemento: a preferência vira a padrão antes, e é reaplicada depois.
  const rate = getStoredSpeed();
  el.defaultPlaybackRate = rate;
  el.poster = item.poster ?? '';
  if (playerKindOf(item) === 'embed') clearVideo(el);
  else el.src = item.src;
  el.playbackRate = rate;
  el.addEventListener(
    'loadedmetadata',
    () => {
      if (resumeAt !== null && resumeAt < el.duration) el.currentTime = resumeAt;
    },
    { once: true },
  );
  attemptPlay();
  if (playerKindOf(item) !== 'embed') void prepareForItem(item, el, { resumeAt, isCurrent: () => current() === item, onMessage: showToast });
  q('.dock-title').textContent = item.title;
  q('.dock-sub').textContent = resumeAt !== null ? `${item.subtitle} · retomando de ${formatDuration(resumeAt)}` : item.subtitle;
  syncControls();
  syncProgress();
  setMediaMetadata(item);
  emit();
};

/** Encerra o vídeo e guarda a posição. */
export const stopPlayer = (): void => {
  persist();
  overlays.clear();
  // O reset do load() não pode gravar a taxa padrão por cima da escolha do usuário.
  if (video) video.defaultPlaybackRate = video.playbackRate;
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
  if (!item || !video) return;
  const handlers = {
    onEmbed: (url: string) => {
      item.embedUrl = url;
      if (current() === item) load(index);
    },
    onMessage: showToast,
  };
  const opts = { resumeAt: resumePoint(store.get(item.key)), isCurrent: () => current() === item, onMessage: showToast };
  void handleUnplayable(item, video, opts).then((handled) => {
    if (!handled) onPlayError(item.src, handlers);
  });
};

/** Monta o player global uma vez no shell; ele sobrevive à troca de telas. */
export const mountPlayerDock = (host: HTMLElement): void => {
  host.innerHTML = DOCK_MARKUP;
  dock = host.querySelector('.dock') as HTMLElement;
  video = dock.querySelector('video') as HTMLVideoElement;
  wirePlayerDock(dock, video, {
    item: current,
    nextTitle: () => (index < queue.length - 1 ? (queue[index + 1]?.title ?? '') : null),
    queueEnded: () => {
      for (const fn of endedListeners) fn();
    },
    overlays,
    persist,
    attemptPlay,
    syncControls,
    syncProgress,
    syncSpeed,
    step,
    stop: stopPlayer,
    keyboardActive,
    onError: onVideoError,
  });
};
