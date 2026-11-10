import { decideSeek, shiftedTime, withStart } from './media-seek.ts';

/**
 * Faz o `<video>` falar a linha do tempo do vídeo inteiro quando toca um stream transcodificado (`?start=`).
 *
 * Em vez de mexer em todo o player, a instância recebe `currentTime` e `duration` próprios. Enquanto o `src` atual for o
 * stream transcodificado, a leitura soma o offset e a escrita reabre o stream se o alvo não estiver baixado. Com outro
 * `src` (arquivo comum), tudo volta a ser o comportamento nativo do elemento.
 */

interface Timeline {
  offset: number;
  duration: number | null;
  base: string;
  src: string;
}

const timelines = new WeakMap<HTMLVideoElement, Timeline>();
const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime') as PropertyDescriptor;
const nativeLength = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration') as PropertyDescriptor;

const activeOf = (video: HTMLVideoElement): Timeline | null => {
  const t = timelines.get(video);
  return t && video.getAttribute('src') === t.src ? t : null;
};

const install = (video: HTMLVideoElement): void => {
  if (timelines.has(video)) return;
  timelines.set(video, { offset: 0, duration: null, base: '', src: '' });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get(this: HTMLVideoElement) {
      const t = activeOf(this);
      const native = nativeTime.get?.call(this) as number;
      return t ? shiftedTime(t.offset, native) : native;
    },
    set(this: HTMLVideoElement, value: number) {
      const t = activeOf(this);
      if (!t) {
        nativeTime.set?.call(this, value);
        return;
      }
      const target = Number(value);
      // Já está nessa posição (ex.: o listener de retomada do dock pedindo o mesmo ponto logo no início): não reabre.
      if (Number.isFinite(target) && Math.abs(target - shiftedTime(t.offset, nativeTime.get?.call(this) as number)) < 0.5) return;
      // Sempre reabre: o seek nativo num stream transcodificado não se comporta de forma confiável.
      const decision = decideSeek(t.offset, target, []);
      if (decision.kind === 'native') nativeTime.set?.call(this, decision.at);
      else reopen(this, t, decision.start);
    },
  });
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get(this: HTMLVideoElement) {
      const t = activeOf(this);
      const native = nativeLength.get?.call(this) as number;
      if (!t) return native;
      if (t.duration !== null) return t.duration;
      return Number.isFinite(native) ? shiftedTime(t.offset, native) : native;
    },
  });
};

const reopen = (video: HTMLVideoElement, t: Timeline, start: number): void => {
  t.offset = start;
  t.src = withStart(t.base, start, location.origin);
  video.setAttribute('src', t.src);
  if (!video.paused) void video.play().catch(() => undefined);
};

/** Toca o stream transcodificado em `base`, começando em `start` segundos do vídeo, que dura `duration` (ou desconhecido). */
export const playTranscoded = (video: HTMLVideoElement, base: string, start: number, duration: number | null): void => {
  install(video);
  const t = timelines.get(video) as Timeline;
  t.base = base;
  t.duration = duration;
  t.offset = Math.max(0, start);
  t.src = withStart(base, t.offset, location.origin);
  video.setAttribute('src', t.src);
};
