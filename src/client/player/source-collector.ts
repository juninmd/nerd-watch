import { streamFacts } from '../addons/stream-filter.ts';
import type { TitleStreamsDto } from '../api/stremio.ts';
import { isPlayable, type StreamPref } from './episode-play-model.ts';

/**
 * Junta as respostas dos addons, uma por vez, para a tela de carregamento (ideia do stream-goat): mostra cada
 * addon assim que ele responde e decide quando começar sem esperar o mais lento. Sem DOM.
 */
export type AddonState = { addonId: string; name: string; status: 'pending' | 'done' | 'error'; count: number; bestHeight: number };

export interface Collected {
  dto: TitleStreamsDto;
  addons: AddonState[];
}

type Group = TitleStreamsDto['addons'][number];

export const startCollect = (addons: Array<{ id: string; name: string }>): Collected => ({
  dto: { imdbId: null, addons: [] },
  addons: addons.map((a) => ({ addonId: a.id, name: a.name, status: 'pending', count: 0, bestHeight: 0 })),
});

const playableHeights = (g: Group): number[] => g.streams.filter(isPlayable).map((s) => streamFacts(s).height);

/** Resposta de um addon: grupos entram na ordem da lista de addons (a mesma da consulta única). */
export const addAnswer = (c: Collected, addonId: string, answer: TitleStreamsDto | null): Collected => {
  const groups = answer?.addons ?? [];
  const order = new Map(c.addons.map((a, i) => [a.addonId, i]));
  const merged = [...c.dto.addons.filter((g) => g.addonId !== addonId), ...groups].sort(
    (x, y) => (order.get(x.addonId) ?? 99) - (order.get(y.addonId) ?? 99),
  );
  const heights = groups.flatMap(playableHeights);
  const failed = answer === null || groups.some((g) => g.error !== null && g.streams.length === 0);
  return {
    dto: { imdbId: c.dto.imdbId ?? answer?.imdbId ?? null, addons: merged },
    addons: c.addons.map((a) =>
      a.addonId === addonId
        ? { ...a, status: failed ? 'error' : 'done', count: heights.length, bestHeight: Math.max(0, ...heights) }
        : a,
    ),
  };
};

export const allAnswered = (c: Collected): boolean => c.addons.every((a) => a.status !== 'pending');
export const hasPlayable = (c: Collected): boolean => c.dto.addons.some((g) => g.streams.some(isPlayable));

/**
 * Começa quando todos responderam, ou antes se já chegou a fonte de sempre (mesmo addon e mesma resolução da
 * última vez): esperar os outros só atrasaria o play.
 */
export const readyToStart = (c: Collected, pref: StreamPref | null): boolean => {
  if (allAnswered(c)) return true;
  if (!pref || pref.height <= 0) return false;
  return c.dto.addons.some(
    (g) => g.addonId === pref.addonId && g.streams.some((s) => isPlayable(s) && streamFacts(s).height === pref.height),
  );
};
