import { registerTap, SEEK_SECONDS, type TapMemory } from '../player-seek.ts';
import { seekVideo } from './player-keyboard.ts';

/** Fração de baixo do palco reservada aos controles nativos: toque ali não é duplo toque de seek. */
const NATIVE_CONTROLS_BAND = 0.8;

/** Duplo toque no lado esquerdo volta 10 s; no direito, avança. Só toque de dedo (mouse usa a barra de controles). */
export const installDoubleTap = (video: HTMLVideoElement): void => {
  let memory: TapMemory | null = null;
  video.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const rect = video.getBoundingClientRect();
    if (video.controls && e.clientY - rect.top > rect.height * NATIVE_CONTROLS_BAND) return;
    const result = registerTap(memory, e.timeStamp, e.clientX - rect.left, rect.width);
    memory = result.memory;
    if (result.seek) seekVideo(video, result.seek === 'back' ? -SEEK_SECONDS : SEEK_SECONDS);
  });
};
