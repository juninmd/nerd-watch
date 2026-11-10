/**
 * Matemática de posição para a transmissão transcodificada (lógica pura, sem DOM).
 *
 * O stream `?start=S` começa no tempo 0 do navegador, mas representa S segundos do vídeo. Então a posição real é
 * `offset + tempo nativo`, e um seek para um ponto fora do trecho já baixado precisa reabrir o stream em outro `start`.
 */

export type MediaPath = 'n/a' | 'direct' | 'remux' | 'transcode' | 'unavailable';

/** Rótulo curto do caminho usado, para o selo na UI. */
export const PATH_LABEL: Record<MediaPath, string> = {
  'n/a': '',
  direct: 'direto',
  remux: 'remux',
  transcode: 'transcodificado',
  unavailable: 'indisponível',
};

export interface Range {
  start: number;
  end: number;
}

/** Posição do vídeo a partir do tempo nativo do elemento. Tempo não finito (stream sem fim) vale 0. */
export const shiftedTime = (offset: number, native: number): number => offset + (Number.isFinite(native) ? native : 0);

/** Se `t` cai em algum trecho já carregado pelo navegador. */
export const inRanges = (ranges: readonly Range[], t: number): boolean => ranges.some((r) => t >= r.start && t <= r.end);

export type SeekDecision = { kind: 'native'; at: number } | { kind: 'reload'; start: number };

/**
 * Decide como atender `currentTime = target`. Dentro do que o navegador já tem (`nativeRanges`, em tempo nativo),
 * basta mover o ponteiro. Fora disso, ou antes do offset atual, o stream é reaberto em `target`.
 */
export const decideSeek = (offset: number, target: number, nativeRanges: readonly Range[]): SeekDecision => {
  const safe = Number.isFinite(target) ? Math.max(0, target) : 0;
  const at = safe - offset;
  if (at >= 0 && inRanges(nativeRanges, at)) return { kind: 'native', at };
  return { kind: 'reload', start: safe };
};

/** URL do stream com `start` (3 casas, como o servidor espera), preservando os demais parâmetros. */
export const withStart = (base: string, start: number, origin: string): string => {
  const url = new URL(base, origin);
  url.searchParams.set('start', Math.max(0, start).toFixed(3));
  return `${url.pathname}${url.search}`;
};
