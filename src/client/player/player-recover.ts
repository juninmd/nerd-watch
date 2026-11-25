import { showToast } from '../app/state.ts';
import type { DockItem } from './dock-item.ts';
import { handleUnplayable } from './media-fallback.ts';
import { onPlayError } from './player-error.ts';

/**
 * Erro do `<video>`: primeiro a conversão (remux/transcodificação) tenta; se não for o caso, a rota de reprodução diz
 * se o vídeo só toca pelo embed ou por que falhou. `start` já traz o `t` do link resolvido, para não perdê-lo.
 */
export const recoverFromVideoError = (
  item: DockItem,
  video: HTMLVideoElement,
  start: { resumeAt: number | null; saved: number | null },
  ctx: { isCurrent(): boolean; onEmbed(url: string): void },
): void => {
  const opts = { resumeAt: start.resumeAt, safeStart: start.saved, isCurrent: ctx.isCurrent, onMessage: showToast };
  void handleUnplayable(item, video, opts).then((handled) => {
    if (!handled && ctx.isCurrent()) onPlayError(item.src, { onEmbed: ctx.onEmbed, onMessage: showToast });
  });
};
