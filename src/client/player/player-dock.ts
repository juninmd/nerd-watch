import { isFinished, type ResumeMeta, resolveStart, resumePoint, type StoredPosition } from './playback-store.ts';
import { MAX_START_SECONDS } from '../app/deep-link.ts';
import { playbackSync } from './playback-service.ts';
import { isAutoplayBlocked } from './player-session.ts';
import { showToast } from '../app/state.ts';
import { formatDuration } from '../ui/time-format.ts';
import { createOverlayController } from './player-overlay-controller.ts';
import { getStoredSpeed } from './player-prefs.ts';
import { setMediaMetadata } from './player-media.ts';
import { onPlayError } from './player-error.ts';
import { handleUnplayable, prepareForItem } from './media-fallback.ts';
import { paintControls, paintProgress, paintSpeed } from './player-dock-view.ts';
import { DOCK_MARKUP } from './player-dock-markup.ts';
import { wirePlayerDock } from './player-dock-wiring.ts';
import { mountPageControls, type PageControls } from './player-page-controls.ts';
import { clearVideo, playerKindOf } from './watch-embed.ts';
import { type Captions, mountCaptions } from './player-captions.ts';
import type { CaptionContext } from './player-captions-model.ts';
import { type CastController, createCastController } from './player-cast.ts';
import { mediaUrl } from '../platform/tauri.ts';

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
  /** Onde buscar legenda para este vídeo (sem ele, o menu só aceita arquivo escolhido pelo usuário). */
  captions?: CaptionContext | null;
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
/** Só a posição salva some (e o apagamento é sincronizado); o vídeo continua no canal/biblioteca. */
export const removeFromContinueWatching = (key: string): void => store.clear(key);
export const clearContinueWatching = (): number => store.clearInProgress();

const metaOf = (item: DockItem): ResumeMeta => ({ title: item.title, subtitle: item.subtitle, poster: item.poster, channelId: item.channelId, messageId: item.messageId, route: item.route });

let dock: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let captions: Captions | null = null;
let cast: CastController | null = null;
let queue: DockItem[] = [];
let index = 0;
let mode: Mode = 'hidden';
let pageControls: PageControls | null = null;
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
  if (video && dock) {
    paintControls(dock, video, index > 0, index < queue.length - 1);
    const castBtn = dock.querySelector<HTMLButtonElement>('[data-act="cast"]');
    const casting = cast?.isActive() ?? false;
    castBtn?.classList.toggle('cast-active', casting);
    castBtn?.setAttribute('aria-pressed', String(casting));
  }
  pageControls?.repaint();
};
const syncProgress = (): void => {
  if (video && dock) paintProgress(dock, video);
  pageControls?.repaint();
};
const syncSpeed = (): void => {
  if (video && dock) paintSpeed(dock, video);
  pageControls?.repaint();
};

const unmountPageControls = (): void => {
  pageControls?.destroy();
  pageControls = null;
};

const setMode = (next: Mode, stage?: HTMLElement): void => {
  if (!dock || !video) return;
  mode = next;
  unmountPageControls();
  if (next === 'page' && stage) {
    stage.appendChild(video);
    pageControls = mountPageControls(stage, video, {
      canPrev: () => index > 0,
      canNext: () => index < queue.length - 1,
      togglePlay: () => (video?.paused ? attemptPlay() : video?.pause()),
      step: (delta) => step(delta),
      openCast: () => cast?.open(),
      isCasting: () => cast?.isActive() ?? false,
    });
  } else {
    q('.dock-video').appendChild(video);
  }
  dock.hidden = next !== 'dock';
  document.body.classList.toggle('has-dock', next === 'dock');
  if (next === 'dock') {
    syncControls();
    syncProgress();
  }
  overlays.repaint();
  captions?.repaint();
};

/** `startAt` vem de um link (`?t=`): vale como ponto de partida, mas só se for um segundo plausível. */
const validStart = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_START_SECONDS ? Math.floor(seconds) : null;

/** Último `t` aplicado nesta sessão de player; um fallback de erro recarrega o mesmo ponto. */
let requestedStart: number | null = null;
/** Listener de `loadedmetadata` pendente do item atual: precisa sair se outro item carregar antes. */
let pendingMetaSeek: (() => void) | null = null;

const clearPendingMetaSeek = (): void => {
  if (video && pendingMetaSeek) video.removeEventListener('loadedmetadata', pendingMetaSeek);
  pendingMetaSeek = null;
};

const load = (i: number, startAt?: number | null): void => {
  const item = queue[i];
  const el = video;
  if (!item || !dock || !el) return;
  clearPendingMetaSeek();
  persist();
  index = i;
  overlays.clear();
  captions?.load(playerKindOf(item) === 'embed' ? null : (item.captions ?? null));
  const savedEntry = store.get(item.key);
  const saved = resumePoint(savedEntry);
  // Resolve o `t` de uma vez (assistido, perto do fim ou fora do vídeo) antes de passar o ponto ao fallback.
  const start = resolveStart({
    saved,
    done: savedEntry?.done === true,
    requested: validStart(startAt),
    duration: item.durationSeconds ?? savedEntry?.duration ?? null,
  });
  requestedStart = start.linkAt;
  const resumeAt = start.resumeAt;
  // Trocar o src volta a taxa para a padrão do elemento: a preferência vira a padrão antes, e é reaplicada depois.
  const rate = getStoredSpeed();
  el.defaultPlaybackRate = rate;
  // Pôster local (`/api/.../thumb`) precisa do loopback no desktop; `src` é reescrito pela ponte, `poster` não.
  el.poster = item.poster ? mediaUrl(item.poster) : '';
  if (playerKindOf(item) === 'embed') clearVideo(el);
  else el.src = item.src;
  el.playbackRate = rate;
  if (playerKindOf(item) !== 'embed') {
    const onMeta = () => {
      pendingMetaSeek = null;
      if (current() !== item || resumeAt === null) return;
      // Duração só descoberta agora: não deixa um `t` fora do vídeo cair no início e apagar o progresso.
      if (Number.isFinite(el.duration) && resumeAt >= el.duration) {
        if (saved !== null && saved < el.duration) el.currentTime = saved;
        return;
      }
      // Um `t` colado no fim não pode marcar como assistido só por abrir: nesse caso volta ao ponto salvo.
      const linkNearEnd = requestedStart !== null && resumeAt === requestedStart && isFinished(resumeAt, el.duration);
      el.currentTime = linkNearEnd ? (saved !== null && saved < el.duration ? saved : 0) : resumeAt;
    };
    pendingMetaSeek = onMeta;
    el.addEventListener('loadedmetadata', onMeta, { once: true });
  }
  attemptPlay();
  if (playerKindOf(item) !== 'embed') {
    void prepareForItem(item, el, { resumeAt, safeStart: saved, isCurrent: () => current() === item, onMessage: showToast });
  }
  q('.dock-title').textContent = item.title;
  q('.dock-sub').textContent = resumeAt !== null ? `${item.subtitle} · retomando de ${formatDuration(resumeAt)}` : item.subtitle;
  syncControls();
  syncProgress();
  setMediaMetadata(item);
  emit();
};

/** Encerra o vídeo e guarda a posição. */
export const stopPlayer = (): void => {
  clearPendingMetaSeek();
  persist();
  overlays.clear();
  captions?.clear();
  void cast?.stop();
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
  unmountPageControls();
  if (mode === 'page' && dock && video) q('.dock-video').appendChild(video);
};

/** Chamado ao sair da tela de reprodução: só encerra se o vídeo ainda estiver "na tela" (não minimizado). */
export const stopIfOnPage = (): void => {
  if (mode === 'page') stopPlayer();
};

/** Como `stopIfOnPage`, mas só se o vídeo estiver dentro de `root`: trocar uma lista de episódios não para o player do título. */
export const stopIfOnPageIn = (root: Node): void => {
  const current = getVideo();
  if (current && root.contains(current)) stopIfOnPage();
};

/**
 * Mostra `items[start]` grande dentro de `stage`. Se já é o vídeo em reprodução, só o reposiciona
 * (sem reiniciar); `startAt` de um link manda no ponto de retomada.
 */
export const showInPage = (items: DockItem[], start: number, stage: HTMLElement, opts: { startAt?: number | null } = {}): void => {
  const target = items[start];
  if (!target || !dock) return;
  const startAt = validStart(opts.startAt);
  const alreadyPlaying = current()?.key === target.key && !!video?.getAttribute('src');
  queue = items;
  index = start;
  setMode('page', stage);
  if (alreadyPlaying) {
    const savedEntry = store.get(target.key);
    const saved = resumePoint(savedEntry);
    const resolved = resolveStart({
      saved,
      done: savedEntry?.done === true,
      requested: startAt,
      duration: target.durationSeconds ?? savedEntry?.duration ?? (video && Number.isFinite(video.duration) ? video.duration : null),
    });
    requestedStart = resolved.linkAt;
    // Sem metadata (`duration` NaN/Infinity) ainda vale atribuir: vira a posição inicial quando ela chegar.
    if (resolved.resumeAt !== null && video && (!Number.isFinite(video.duration) || resolved.resumeAt < video.duration)) {
      video.currentTime = resolved.resumeAt;
    }
    syncControls();
    emit();
  } else load(start, startAt);
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
      if (current() === item) load(index, requestedStart);
    },
    onMessage: showToast,
  };
  // Um link (`?t=`) não pode ser perdido porque o navegador não tocou o arquivo no primeiro try.
  const savedEntry = store.get(item.key);
  const saved = resumePoint(savedEntry);
  const resolved = resolveStart({
    saved,
    done: savedEntry?.done === true,
    requested: requestedStart,
    duration: item.durationSeconds ?? savedEntry?.duration ?? (Number.isFinite(video.duration) ? video.duration : null),
  });
  const opts = { resumeAt: resolved.resumeAt, safeStart: saved, isCurrent: () => current() === item, onMessage: showToast };
  void handleUnplayable(item, video, opts).then((handled) => {
    if (!handled && current() === item) onPlayError(item.src, handlers);
  });
};

/** Monta o player global uma vez no shell; ele sobrevive à troca de telas. */
export const mountPlayerDock = (host: HTMLElement): void => {
  host.innerHTML = DOCK_MARKUP;
  dock = host.querySelector('.dock') as HTMLElement;
  video = dock.querySelector('video') as HTMLVideoElement;
  // Legendas: na barra fixa o menu fica nos controles; no palco da tela de reprodução, sobre o vídeo.
  captions = mountCaptions({
    video: () => video,
    host: () => (mode === 'dock' ? q('.dock-controls') : mode === 'page' ? (video?.parentElement ?? null) : null),
  });
  cast = createCastController({
    item: current,
    video: () => video,
    onStateChange: syncControls,
  });
  wirePlayerDock(dock, video, {
    toggleCaptions: () => captions?.toggle(),
    openCast: () => cast?.open(),
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
