import { patchLibrary, removeFromLibrary } from './api.ts';
import type { LinkedProgressDto } from './playback-api.ts';
import { showToast } from './state.ts';

/** Vídeo de canal vinculado avançou "Onde parei": avisa com desfazer, que volta exatamente ao estado anterior. */
export const announceLinkedProgress = (p: LinkedProgressDto): void => {
  showToast(`Onde parei: T${p.seasonNumber} · Ep ${p.episodeNumber}`, { label: 'Desfazer', run: () => undoLinkedProgress(p) });
};

const undoLinkedProgress = (p: LinkedProgressDto): void => {
  let restore: Promise<unknown>;
  if (p.previous) {
    restore = patchLibrary(p.titleId, {
      watchStatus: p.previous.watchStatus,
      currentSeason: p.previous.currentSeason,
      currentEpisode: p.previous.currentEpisode,
    });
  } else if (p.entryId) {
    restore = removeFromLibrary(p.entryId);
  } else {
    restore = Promise.resolve();
  }
  restore.then(() => showToast('progresso desfeito')).catch(() => showToast('não foi possível desfazer'));
};
