import { formatVttTime } from './srt-vtt.ts';

/**
 * Alinhamento de legenda pelo tempo. Compara as linhas de tempo de uma legenda (addon) com uma referência
 * (legenda embutida no próprio vídeo) e estima um atraso constante mais uma deriva linear (`r = a·s + b`).
 * Puro: sem DOM e sem rede. Só corrige quando há consenso claro entre as duas; em dúvida, devolve a original.
 *
 * Não usa áudio nem modelo de fala: só os instantes de início das falas, que é o que as duas trilhas têm em comum.
 */

export interface TimedCue {
  start: number;
  end: number;
}

/** Atraso máximo considerado (um atraso de minutos quase sempre é outro arquivo, não ajuste). */
export const MAX_OFFSET_MS = 60_000;
/** Duas falas "batem" quando os inícios diferem até isto. */
export const MATCH_TOLERANCE_MS = 250;
/** Granularidade do histograma de atrasos candidatos. */
const BIN_MS = 100;
/** Consenso mínimo: pelo menos estas falas batendo, e uma fração delas do total. */
export const MIN_INLIERS = 10;
export const MIN_INLIER_RATIO = 0.3;
/** Deriva além disso (ex.: 25 fps contra 23,976 fps já dá ~4%) é suspeita demais para aplicar sem revisão. */
export const MAX_SCALE_DEVIATION = 0.05;
/** Passo da varredura de escalas (0,1% de deriva por passo). */
const SCALE_STEP = 0.001;

export interface SyncFit {
  /** Mapeamento aplicado: tempo da legenda `t` vira `scale * t + offsetMs`. */
  scale: number;
  offsetMs: number;
  /** Falas da legenda que batem com a referência depois do ajuste. */
  inliers: number;
  total: number;
}

export type SyncOutcome =
  | { applied: true; fit: SyncFit }
  | { applied: false; reason: 'empty' | 'already_in_sync' | 'no_consensus'; fit: SyncFit | null };

const VTT_TIME_LINE = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})\.(\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})\.(\d{1,3})/;

const toMs = (h: string | undefined, m: string, s: string, frac: string): number =>
  ((Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, '0'));

/** Lê as linhas de tempo de um WebVTT já normalizado (saída de `toWebVtt`). */
export const parseVttCues = (vtt: string): TimedCue[] => {
  const cues: TimedCue[] = [];
  for (const line of vtt.split('\n')) {
    const m = VTT_TIME_LINE.exec(line);
    if (!m) continue;
    const start = toMs(m[1], m[2] ?? '0', m[3] ?? '0', m[4] ?? '0');
    const end = toMs(m[5], m[6] ?? '0', m[7] ?? '0', m[8] ?? '0');
    if (end > start) cues.push({ start, end });
  }
  return cues;
};

/** Primeiro índice cujo valor é >= x (array ordenado). */
const lowerBound = (sorted: number[], x: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Quantas falas da legenda, depois de `a·s + b`, têm uma fala da referência a até MATCH_TOLERANCE_MS. */
const countInliers = (subStarts: number[], refStarts: number[], a: number, b: number): number => {
  let n = 0;
  for (const s of subStarts) {
    const t = a * s + b;
    const i = lowerBound(refStarts, t - MATCH_TOLERANCE_MS);
    if (i < refStarts.length && (refStarts[i] ?? Infinity) <= t + MATCH_TOLERANCE_MS) n++;
  }
  return n;
};

/** Moda do histograma de `ref - (a·sub + 0)` para uma escala `a`: o atraso mais provável com essa escala. */
const modeFor = (subStarts: number[], refStarts: number[], scale: number): { offset: number; count: number } | null => {
  const hist = new Map<number, number>();
  for (const s of subStarts) {
    const t = scale * s;
    for (let i = lowerBound(refStarts, t - MAX_OFFSET_MS); i < refStarts.length; i++) {
      const d = (refStarts[i] ?? 0) - t;
      if (d > MAX_OFFSET_MS) break;
      const bin = Math.round(d / BIN_MS);
      hist.set(bin, (hist.get(bin) ?? 0) + 1);
    }
  }
  if (hist.size === 0) return null;
  // Empate vai para o atraso menor em módulo: sem evidência, o menor ajuste é o mais seguro.
  let mode = 0;
  let count = -1;
  for (const [bin, c] of hist) {
    if (c > count || (c === count && Math.abs(bin) < Math.abs(mode))) {
      mode = bin;
      count = c;
    }
  }
  return { offset: mode * BIN_MS, count };
};

/** Mínimos quadrados de `r = a·s + b` sobre os pares que batem com o mapeamento de partida. */
const fitLine = (subStarts: number[], refStarts: number[], a0: number, b0: number): { a: number; b: number } | null => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of subStarts) {
    const target = a0 * s + b0;
    const i = lowerBound(refStarts, target - MATCH_TOLERANCE_MS);
    const r = refStarts[i];
    if (r !== undefined && r <= target + MATCH_TOLERANCE_MS) {
      xs.push(s);
      ys.push(r);
    }
  }
  const n = xs.length;
  if (n < MIN_INLIERS) return null;
  const mx = xs.reduce((acc, x) => acc + x, 0) / n;
  const my = ys.reduce((acc, y) => acc + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    const dx = (xs[k] ?? 0) - mx;
    sxx += dx * dx;
    sxy += dx * ((ys[k] ?? 0) - my);
  }
  if (sxx === 0) return null;
  const a = sxy / sxx;
  return { a, b: my - a * mx };
};

/** Estima o ajuste de uma legenda contra a referência, sem aplicar nada. Varre escalas dentro do limite de deriva. */
export const fitSubtitleSync = (sub: TimedCue[], ref: TimedCue[]): { fit: SyncFit; baseline: number } | null => {
  if (sub.length === 0 || ref.length === 0) return null;
  const subStarts = sub.map((c) => c.start).sort((x, y) => x - y);
  const refStarts = ref.map((c) => c.start).sort((x, y) => x - y);
  const total = subStarts.length;
  const baseline = countInliers(subStarts, refStarts, 1, 0);

  // Escala candidata: a que dá a moda de atraso mais forte. Empate fica com a escala mais perto de 1.
  let bestScale = 1;
  let bestMode: { offset: number; count: number } | null = null;
  const steps = Math.round(MAX_SCALE_DEVIATION / SCALE_STEP);
  for (let k = -steps; k <= steps; k++) {
    const scale = 1 + k * SCALE_STEP;
    const m = modeFor(subStarts, refStarts, scale);
    if (!m) continue;
    if (!bestMode || m.count > bestMode.count || (m.count === bestMode.count && Math.abs(scale - 1) < Math.abs(bestScale - 1))) {
      bestMode = m;
      bestScale = scale;
    }
  }
  if (!bestMode) return { fit: { scale: 1, offsetMs: 0, inliers: 0, total }, baseline };

  // Refina: reta de mínimos quadrados sobre os pares que batem; fica com o que tiver mais falas batendo.
  const candidates: Array<{ scale: number; offsetMs: number }> = [{ scale: bestScale, offsetMs: bestMode.offset }];
  const line = fitLine(subStarts, refStarts, bestScale, bestMode.offset);
  if (line && Math.abs(line.a - 1) <= MAX_SCALE_DEVIATION) candidates.push({ scale: line.a, offsetMs: line.b });
  let best: SyncFit | null = null;
  for (const c of candidates) {
    const inliers = countInliers(subStarts, refStarts, c.scale, c.offsetMs);
    if (!best || inliers > best.inliers) best = { scale: c.scale, offsetMs: c.offsetMs, inliers, total };
  }
  return best ? { fit: best, baseline } : null;
};

/** Decide se o ajuste é confiável o bastante para aplicar. */
export const decideSync = (sub: TimedCue[], ref: TimedCue[]): SyncOutcome => {
  const estimated = fitSubtitleSync(sub, ref);
  if (!estimated) return { applied: false, reason: 'empty', fit: null };
  const { fit, baseline } = estimated;
  // Sem ajuste, a legenda já bate com a referência quase tanto quanto com o ajuste: não mexer.
  if (baseline >= fit.inliers * 0.9 && Math.abs(fit.offsetMs) <= MATCH_TOLERANCE_MS && Math.abs(fit.scale - 1) < 1e-3) {
    return { applied: false, reason: 'already_in_sync', fit };
  }
  if (fit.inliers < MIN_INLIERS || fit.inliers / fit.total < MIN_INLIER_RATIO || fit.inliers < baseline * 2) {
    return { applied: false, reason: 'no_consensus', fit };
  }
  return { applied: true, fit };
};

/** Aplica o mapeamento a um tempo (nunca negativo: uma fala que "volta" antes de zero é colada em zero). */
export const mapTime = (ms: number, fit: SyncFit): number => Math.max(0, Math.round(fit.scale * ms + fit.offsetMs));

/** Reescreve as linhas de tempo de um WebVTT com o mapeamento; o texto das falas não muda. */
export const retimeVtt = (vtt: string, fit: SyncFit): string =>
  vtt
    .split('\n')
    .map((line) => {
      const m = VTT_TIME_LINE.exec(line);
      if (!m) return line;
      const start = mapTime(toMs(m[1], m[2] ?? '0', m[3] ?? '0', m[4] ?? '0'), fit);
      const end = mapTime(toMs(m[5], m[6] ?? '0', m[7] ?? '0', m[8] ?? '0'), fit);
      return `${formatVttTime(start)} --> ${formatVttTime(end)}`;
    })
    .join('\n');

/** Ponto de entrada: legenda WebVTT contra referência WebVTT. Quando não aplica, devolve a legenda intacta. */
export const alignSubtitleVtt = (subtitleVtt: string, referenceVtt: string): { vtt: string; outcome: SyncOutcome } => {
  const outcome = decideSync(parseVttCues(subtitleVtt), parseVttCues(referenceVtt));
  if (!outcome.applied) return { vtt: subtitleVtt, outcome };
  return { vtt: retimeVtt(subtitleVtt, outcome.fit), outcome };
};
