import type { DockItem } from './dock-item.ts';
import { metaOf } from './playback-positions.ts';
import { playbackSync } from './playback-service.ts';
import { isAutoplayBlocked } from './player-session.ts';
import { showToast } from '../app/state.ts';
import { formatDuration } from '../ui/time-format.ts';
import { createOverlayController } from './player-overlay-controller.ts';
import { getStoredSpeed } from './player-prefs.ts';
import { setMediaMetadata, syncMediaPosition } from './player-media.ts';
import { prepareForItem } from './media-fallback.ts';
import { recoverFromVideoError } from './player-recover.ts';
import { createVideoElement, wirePlayerVideo } from './player-dock-wiring.ts';
import { playerKeysActive } from './player-keyboard.ts';
import { clearVideo, playerKindOf } from './watch-embed.ts';
import { createCaptions } from './player-captions.ts';
import type { Captions } from './player-captions-types.ts';
import { type CastController, createCastController } from './player-cast.ts';
import { openCastDialog } from './player-cast-dialog.tsx';
import { emitEnded, emitPlayer } from './player-events.ts';
import { finiteDuration, resumeFor, seekOnMetadata, validStart } from './player-resume.ts';
import { bumpPlayerUi } from './player-ui-store.ts';
import { mediaUrl } from '../platform/tauri.ts';

export type { DockItem } from './dock-item.ts';
export { clearContinueWatching, continueWatching } from './playback-positions.ts';
export { removeFromContinueWatching, savedPosition } from './playback-positions.ts';
export { subscribeEnded, subscribePlayer } from './player-events.ts';
export { getAutoplay, getQueueOrder, type QueueOrder, setAutoplay, setQueueOrder } from './player-prefs.ts';

/**
 * Um único `<video>` global: "page" (grande, no palco da tela) ou "dock" (barra fixa, só depois de `minimizePlayer`).
 * Mover o elemento entre os dois não o reinicia. Estado imperativo aqui; os botões são React (player-dock-bar.tsx).
 */
export type Mode = 'hidden' | 'page' | 'dock';

const store = playbackSync.store;

/** Vaga do `<video>` na barra fixa (montada pela casca) e palco da tela que o mostra grande agora. */
let dockSlot: HTMLElement | null = null;
let pageStage: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let captions: Captions | null = null;
let cast: CastController | null = null;
let queue: DockItem[] = [];
let index = 0;
let mode: Mode = 'hidden';

/** Toque para reproduzir (autoplay bloqueado) e contagem do próximo vídeo: ficam no palco ou na barra, conforme o modo. */
const overlays = createOverlayController({ onChange: bumpPlayerUi, onNext: () => step(1), onTap: () => attemptPlay() });

/** `play()` recusado por autoplay vira pedido de toque. AbortError/NotSupportedError já têm tratamento próprio. */
const attemptPlay = (): void => {
  video?.play().catch((err: unknown) => {
    if (isAutoplayBlocked(err)) overlays.askTap();
    syncControls();
  });
};

/** Teclas valem com o foco no player, ou na tela de reprodução sem foco em campo. Outras telas seguem normais. */
const keyboardActive = (): boolean => {
  const item = current();
  if (!video || !item || playerKindOf(item) === 'embed') return false;
  return playerKeysActive(
    mode === 'dock' ? (dockSlot?.closest('.dock') ?? null) : video.parentElement,
    mode === 'page',
  );
};

const current = (): DockItem | undefined => queue[index];

export const getNowPlaying = (): { item: DockItem; queue: DockItem[]; index: number; mode: Mode } | null => {
  const item = current();
  return item ? { item, queue, index, mode } : null;
};

export const getVideo = (): HTMLVideoElement | null => video;
export const getOverlays = () => overlays;
export const getCaptions = (): Captions | null => captions;
export const getCast = (): CastController | null => cast;
/** Palco que mostra o vídeo grande agora (null na barra fixa ou fechado): cada palco desenha os controles só se for o dono. */
export const getPageStage = (): HTMLElement | null => (mode === 'page' ? pageStage : null);
export const canStep = (delta: number): boolean => index + delta >= 0 && index + delta < queue.length;
/** Linha de baixo da barra fixa: "canal · retomando de 3:20" quando o vídeo abriu de uma posição salva. */
let dockSubtitle = '';
export const getDockSubtitle = (): string => dockSubtitle;

const persist = (): void => {
  const item = current();
  if (!item || !video || video.readyState < 1) return;
  store.save(item.key, video.currentTime, finiteDuration(video), metaOf(item));
};

/** Botões, tempo e velocidade são React: basta avisar que o estado do `<video>` mudou. */
const syncControls = bumpPlayerUi;
const syncProgress = (): void => {
  if (video) syncMediaPosition(video);
  bumpPlayerUi();
};

const placeVideo = (el: HTMLVideoElement, host: HTMLElement | null): void => {
  // Primeiro filho: os overlays e a barra (irmãos React) ficam por cima e `video[hidden] ~ .pc` continua valendo.
  if (host && el.parentElement !== host) host.prepend(el);
};

const setMode = (next: Mode, stage?: HTMLElement): void => {
  if (!video) return;
  mode = next;
  pageStage = next === 'page' && stage ? stage : null;
  placeVideo(video, pageStage ?? dockSlot);
  document.body.classList.toggle('has-dock', next === 'dock');
  bumpPlayerUi();
};

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
  if (!item || !el) return;
  const isCurrent = (): boolean => current() === item;
  clearPendingMetaSeek();
  persist();
  index = i;
  overlays.clear();
  captions?.load(playerKindOf(item) === 'embed' ? null : (item.captions ?? null));
  // Resolve o `t` de uma vez (assistido, perto do fim ou fora do vídeo) antes de passar o ponto ao fallback.
  const { saved, resumeAt, linkAt } = resumeFor(item, store.get(item.key), validStart(startAt));
  requestedStart = linkAt;
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
      if (isCurrent()) seekOnMetadata(el, resumeAt, saved, requestedStart);
    };
    pendingMetaSeek = onMeta;
    el.addEventListener('loadedmetadata', onMeta, { once: true });
  }
  attemptPlay();
  if (playerKindOf(item) !== 'embed') {
    void prepareForItem(item, el, { resumeAt, safeStart: saved, isCurrent, onMessage: showToast });
  }
  dockSubtitle = resumeAt !== null ? `${item.subtitle} · retomando de ${formatDuration(resumeAt)}` : item.subtitle;
  syncControls();
  syncProgress();
  setMediaMetadata(item);
  emitPlayer();
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
  emitPlayer();
};

/** Antes de trocar a tela: tira o `<video>` da view que vai ser descartada (um nó fora do documento pausaria). */
export const parkPlayer = (): void => {
  pageStage = null;
  if (mode === 'page' && video) placeVideo(video, dockSlot);
  bumpPlayerUi();
};

/** O palco saiu da tela (React desmontou): o vídeo volta para a vaga da barra antes de o nó sumir (fora do documento pausaria). */
export const releaseStage = (stage: HTMLElement): void => {
  if (pageStage === stage) parkPlayer();
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
export const showInPage = (
  items: DockItem[],
  start: number,
  stage: HTMLElement,
  opts: { startAt?: number | null } = {},
): void => {
  const target = items[start];
  if (!target || !video) return;
  const startAt = validStart(opts.startAt);
  const alreadyPlaying = current()?.key === target.key && !!video?.getAttribute('src');
  queue = items;
  index = start;
  setMode('page', stage);
  if (alreadyPlaying) {
    const resolved = resumeFor(target, store.get(target.key), startAt, finiteDuration(video));
    requestedStart = resolved.linkAt;
    // Sem metadata (`duration` NaN/Infinity) ainda vale atribuir: vira a posição inicial quando ela chegar.
    if (
      resolved.resumeAt !== null &&
      video &&
      (!Number.isFinite(video.duration) || resolved.resumeAt < video.duration)
    ) {
      video.currentTime = resolved.resumeAt;
    }
    syncControls();
    emitPlayer();
  } else load(start, startAt);
};

/** Botão "minimizar": o vídeo continua tocando, agora na barra fixa. */
export const minimizePlayer = (): void => {
  if (mode === 'page' && current()) setMode('dock');
  emitPlayer();
};

export const playIndex = (i: number): void => {
  if (i >= 0 && i < queue.length) load(i);
};

const step = (delta: number): void => playIndex(index + delta);

const onVideoError = (): void => {
  const item = current();
  if (!item || !video) return;
  // Um link (`?t=`) não pode ser perdido porque o navegador não tocou o arquivo no primeiro try.
  recoverFromVideoError(item, video, resumeFor(item, store.get(item.key), requestedStart, finiteDuration(video)), {
    isCurrent: () => current() === item,
    onEmbed: (url) => {
      item.embedUrl = url;
      if (current() === item) load(index, requestedStart);
    },
  });
};

/** Cria o `<video>` global uma vez e liga os eventos; ele sobrevive à troca de telas. */
const createVideo = (): HTMLVideoElement => {
  const el = createVideoElement();
  video = el;
  captions = createCaptions({ video: () => video });
  cast = createCastController({
    item: current,
    video: () => video,
    onStateChange: syncControls,
    showDialog: openCastDialog,
  });
  wirePlayerVideo(el, {
    toggleCaptions: () => captions?.toggle(),
    nextTitle: () => (index < queue.length - 1 ? (queue[index + 1]?.title ?? '') : null),
    queueEnded: emitEnded,
    overlays,
    persist,
    attemptPlay,
    syncControls,
    syncProgress,
    step,
    keyboardActive,
    onError: onVideoError,
  });
  return el;
};

/** A barra fixa (React) entrega a vaga do `<video>` ao montar; na primeira vez o elemento nasce aqui. */
export const attachDockSlot = (slot: HTMLElement | null): void => {
  dockSlot = slot;
  const el = video ?? createVideo();
  if (!pageStage) placeVideo(el, slot);
};

export const togglePlay = (): void => (video?.paused ? attemptPlay() : video?.pause());

export const stepPlayer = (delta: number): void => step(delta);
