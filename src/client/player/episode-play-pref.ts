import type { StreamPref } from './episode-play-model.ts';

/** Fonte preferida (addon e altura) do último episódio assistido, para o próximo abrir com a mesma. */
const PREF_KEY = 'nw.play.pref';

export const readStreamPref = (): StreamPref | null => {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as StreamPref | null;
    return v && typeof v.addonId === 'string' && Number.isFinite(v.height) ? v : null;
  } catch {
    return null;
  }
};

export const saveStreamPref = (p: StreamPref): void => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Sem storage (modo privado): só não lembra a fonte no próximo episódio.
  }
};
