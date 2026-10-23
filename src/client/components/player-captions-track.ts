import { CAPTION_COLORS, CAPTION_SIZES, type CaptionStyle } from '../player-captions-prefs.ts';
import { shiftedCue } from '../player-captions-offset.ts';

/**
 * Um único `<track>` de legenda por vez no `<video>`. O WebVTT entra por blob URL; o tempo original de cada
 * cue fica guardado para o atraso ser reaplicado sem refazer o download.
 */

/** Sem resposta do `<track>` em tanto tempo, a escolha falha em vez de deixar o menu preso em "carregando". */
const TRACK_TIMEOUT_MS = 8_000;

export interface MountedTrack {
  el: HTMLTrackElement;
  url: string;
  cues: Array<{ cue: TextTrackCue; start: number; end: number }>;
}

export interface TrackSlot {
  /** Monta a legenda e resolve com a faixa quando o navegador a carregou; null se falhou ou expirou. */
  attach(
    video: HTMLVideoElement,
    vtt: string,
    label: string,
    lang: string | null,
    offsetMs: number,
  ): Promise<MountedTrack | null>;
  drop(): void;
  /** Remove só se esta ainda for a faixa montada (uma escolha mais nova pode já tê-la trocado). */
  dropIf(track: MountedTrack): void;
  shift(offsetMs: number): void;
}

export const createTrackSlot = (): TrackSlot => {
  let mounted: MountedTrack | null = null;

  const shift = (offsetMs: number): void => {
    if (!mounted) return;
    for (const c of mounted.cues) {
      const s = shiftedCue(c.start, c.end, offsetMs);
      c.cue.startTime = s.start;
      c.cue.endTime = s.end;
    }
  };

  const drop = (): void => {
    if (!mounted) return;
    mounted.el.remove();
    URL.revokeObjectURL(mounted.url);
    mounted = null;
  };

  const dropIf = (track: MountedTrack): void => {
    if (mounted === track) drop();
  };

  const attach: TrackSlot['attach'] = (video, vtt, label, lang, offsetMs) => {
    drop();
    const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    const el = document.createElement('track');
    el.kind = 'subtitles';
    el.label = label;
    el.srclang = lang ?? 'und';
    el.src = url;
    video.appendChild(el);
    const track: MountedTrack = { el, url, cues: [] };
    mounted = track;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (ok: boolean) => {
        if (timer) clearTimeout(timer);
        el.removeEventListener('load', onLoad);
        el.removeEventListener('error', onError);
        if (!ok) dropIf(track);
        resolve(ok ? track : null);
      };
      const onLoad = () => {
        if (mounted !== track) return finish(false);
        track.cues = Array.from(el.track.cues ?? []).map((cue) => ({ cue, start: cue.startTime, end: cue.endTime }));
        shift(offsetMs);
        el.track.mode = 'showing';
        finish(true);
      };
      const onError = () => finish(false);
      el.addEventListener('load', onLoad);
      el.addEventListener('error', onError);
      timer = setTimeout(() => finish(false), TRACK_TIMEOUT_MS);
      // Oculta por enquanto: só assim o navegador carrega os cues, sem mostrar nada antes da hora.
      el.track.mode = 'hidden';
    });
  };

  return { attach, drop, dropIf, shift };
};

/** Variáveis que o `::cue` lê (ver captions.css). Sem vídeo, não faz nada. */
export const applyCaptionStyle = (el: HTMLVideoElement | null, style: CaptionStyle): void => {
  if (!el) return;
  el.style.setProperty('--nw-cue-scale', String(CAPTION_SIZES[style.size]));
  el.style.setProperty('--nw-cue-bg', String(style.background / 100));
  el.style.setProperty('--nw-cue-color', CAPTION_COLORS[style.color]);
};
