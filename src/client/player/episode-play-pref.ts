import type { StreamPref } from './episode-play-model.ts';

/**
 * Fonte preferida (addon e altura). Vale por série (a última que tocou nela, como o LastSource do stream-goat) e,
 * para série nunca tocada, a última de qualquer série.
 */
const PREF_KEY = 'nw.play.pref';
const BY_TITLE_KEY = 'nw.play.pref.titles';
/** Teto de séries lembradas: o mapa não cresce sem limite no localStorage. */
export const PREF_TITLES_MAX = 200;

const valid = (v: unknown): v is StreamPref =>
  typeof v === 'object' && v !== null && typeof (v as StreamPref).addonId === 'string' && Number.isFinite((v as StreamPref).height);

const readJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};

const readMap = (): Record<string, StreamPref & { at?: number }> => {
  const m = readJson(BY_TITLE_KEY);
  return typeof m === 'object' && m !== null && !Array.isArray(m) ? (m as Record<string, StreamPref & { at?: number }>) : {};
};

export const readStreamPref = (titleKey?: string): StreamPref | null => {
  const own = titleKey ? readMap()[titleKey] : undefined;
  if (valid(own)) return { addonId: own.addonId, height: own.height };
  const v = readJson(PREF_KEY);
  return valid(v) ? v : null;
};

/** Mantém as `max` séries tocadas mais recentemente. Puro: testável sem storage. */
export const prunePrefs = <T extends { at?: number }>(map: Record<string, T>, max: number): Record<string, T> => {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const keep = keys.sort((a, b) => (map[b]?.at ?? 0) - (map[a]?.at ?? 0)).slice(0, max);
  return Object.fromEntries(keep.map((k) => [k, map[k] as T]));
};

export const saveStreamPref = (p: StreamPref, titleKey?: string): void => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
    if (titleKey) {
      const map = { ...readMap(), [titleKey]: { ...p, at: Date.now() } };
      localStorage.setItem(BY_TITLE_KEY, JSON.stringify(prunePrefs(map, PREF_TITLES_MAX)));
    }
  } catch {
    // Sem storage (modo privado): só não lembra a fonte no próximo episódio.
  }
};
