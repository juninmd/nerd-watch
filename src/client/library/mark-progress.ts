import { markProgressThrough, patchLibrary, removeFromLibrary, type MarkThroughResult } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import type { EpisodeMarker } from './episode-progress.ts';

/** Desfaz a marcação com o estado que estava antes (ou tira a entrada, se a série não estava na lista). */
const undoMark = (titleId: string, result: MarkThroughResult, onChange: (m: EpisodeMarker | null) => void): void => {
  const prev = result.previous;
  const restore = prev
    ? patchLibrary(titleId, { watchStatus: prev.watchStatus, currentSeason: prev.currentSeason, currentEpisode: prev.currentEpisode })
    : removeFromLibrary(result.item.id);
  restore
    .then(() => {
      showToast('progresso desfeito');
      onChange(prev?.currentSeason != null && prev.currentEpisode != null ? { season: prev.currentSeason, episode: prev.currentEpisode } : null);
    })
    .catch(() => showToast('não foi possível desfazer'));
};

/**
 * "Visto até aqui" com toast e Desfazer. `onChange` recebe o marcador novo (ou o restaurado) para a tela repintar
 * sem recarregar a ficha inteira. Rejeita quando falha, para o botão voltar a ficar ativo.
 */
export const markThrough = (titleId: string, season: number, episode: number, onChange: (m: EpisodeMarker | null) => void): Promise<void> =>
  markProgressThrough(titleId, season, episode).then(
    (res) => {
      if (!res.changed) {
        showToast('já estava marcado até aqui');
        return;
      }
      onChange({ season, episode });
      showToast(`marcado até T${season} · Ep ${episode}`, { label: 'Desfazer', run: () => undoMark(titleId, res, onChange) });
    },
    (err: unknown) => {
      showToast('não foi possível marcar');
      throw err;
    },
  );
