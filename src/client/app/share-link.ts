import { getNowPlaying, getVideo, savedPosition } from '../player/player-dock.ts';
import { resumePoint } from '../player/playback-store.ts';
import { inAppUrl, parseStartTime, routeWithQuery, startSecond } from './deep-link.ts';
import { currentRoute } from './router.ts';
import { showToast } from './state.ts';

const WATCH_PATH = /^\/watch\/([^/]+)\/(\d+)$/;

export interface ScreenShare {
  path: string;
  /** Segundo em que o vídeo deve abrir; `null` quando a tela não tem tempo. */
  at: number | null;
}

/** O desktop embute o cliente e não serve a página por HTTP; link externo só faz sentido na versão web. */
export const canShareAppLink = (): boolean => typeof window === 'undefined' || window.__NERD_WATCH_TAURI__ !== true;

/**
 * Rota da tela atual já com a posição: na tela de reprodução vale o `currentTime` (ou a última
 * posição salva); nas outras, o link é só da tela.
 */
export const currentScreenShare = (): ScreenShare => {
  const route = currentRoute();
  const watch = WATCH_PATH.exec(route.path);
  if (!watch) return { path: routeWithQuery(route), at: parseStartTime(route.query.get('t')) };

  const [, channelId, messageId] = watch;
  const now = getNowPlaying();
  const video = getVideo();
  const sameVideo = now !== null && now.item.channelId === channelId && now.item.messageId === messageId;
  const live = sameVideo && video ? video.currentTime : null;
  const saved = resumePoint(savedPosition(`${channelId}:${messageId}`));
  return { path: route.path, at: startSecond(live, saved, parseStartTime(route.query.get('t'))) };
};

/** `navigator.clipboard` exige contexto seguro; na LAN em http cai no textarea + execCommand. */
export const copyText = async (text: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // segue para o fallback
    }
  }
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, area.value.length);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    focused?.focus({ preventScroll: true });
  }
};

/** Copia um link interno e avisa no toast. */
export const copyAppLink = (path: string, opts: { at?: number | null; label?: string } = {}): void => {
  if (!canShareAppLink()) {
    showToast('Links internos estão disponíveis na versão web do app');
    return;
  }
  const url = inAppUrl(path, opts.at);
  const label = opts.label ?? 'Link';
  void copyText(url).then((ok) => showToast(ok ? `${label} copiado` : 'Não foi possível copiar o link'));
};

/** Ação da barra superior: copia a tela atual (com o tempo do vídeo, quando houver). */
export const copyCurrentScreenLink = (): void => {
  const { path, at } = currentScreenShare();
  copyAppLink(path, { at, label: 'Link desta tela' });
};
