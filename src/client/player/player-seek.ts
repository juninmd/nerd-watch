/** Matemática do player (sem DOM): saltos, volume, velocidade e duplo toque. Quem chama aplica o resultado no `<video>`. */

export const SEEK_SECONDS = 10;
export const ARROW_SEEK_SECONDS = 5;
export const VOLUME_STEP = 0.05;

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2;
export const DEFAULT_SPEED = 1;
export const SPEED_STEPS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Só dá para posicionar com duração finita e positiva: ao vivo (Infinity) ou sem metadados (NaN) não há destino. */
const seekable = (duration: number): boolean => Number.isFinite(duration) && duration > 0;

/** Novo tempo ao pular `seconds` a partir de `current`, limitado ao vídeo. Null quando não há como pular. */
export const seekTarget = (current: number, seconds: number, duration: number): number | null => {
  if (!Number.isFinite(current) || !seekable(duration)) return null;
  return clamp(current + seconds, 0, duration);
};

/** Tecla 0-9: 0% a 90% da duração. */
export const percentTarget = (digit: number, duration: number): number | null => {
  if (!seekable(duration)) return null;
  return clamp((digit / 10) * duration, 0, duration);
};

/** Volume novo com arredondamento de 2 casas (0.25 + 0.05 não pode virar 0.30000000000000004). */
export const volumeTarget = (current: number, delta: number): number | null => {
  if (!Number.isFinite(current)) return null;
  return round2(clamp(current + delta, 0, 1));
};

export const isValidSpeed = (rate: number): boolean => Number.isFinite(rate) && rate >= MIN_SPEED && rate <= MAX_SPEED;

/** Velocidade lida do armazenamento: valor fora de 0,5x–2x (ou lixo) vira 1x. */
export const parseSpeed = (raw: string | null): number => {
  const rate = raw === null ? Number.NaN : Number(raw);
  return isValidSpeed(rate) ? rate : DEFAULT_SPEED;
};

const EPS = 1e-6;

/** Próximo passo de velocidade (`dir` 1 = mais rápido). Nas pontas, fica onde está. */
export const nextSpeed = (current: number, dir: 1 | -1): number => {
  const from = Number.isFinite(current) ? current : DEFAULT_SPEED;
  if (dir > 0) return SPEED_STEPS.find((s) => s > from + EPS) ?? MAX_SPEED;
  return [...SPEED_STEPS].reverse().find((s) => s < from - EPS) ?? MIN_SPEED;
};

/** Janela do duplo toque: dois toques no mesmo lado dentro desse tempo pulam 10 s. */
export const DOUBLE_TAP_MS = 300;

export type TapSide = 'back' | 'forward';
export interface TapMemory {
  at: number;
  side: TapSide;
}
export interface TapResult {
  seek: TapSide | null;
  memory: TapMemory | null;
}

/** Classifica um toque pelo lado da tela. Pura: quem chama guarda a memória entre toques. */
export const registerTap = (prev: TapMemory | null, at: number, x: number, width: number): TapResult => {
  if (!Number.isFinite(x) || !(width > 0)) return { seek: null, memory: null };
  const side: TapSide = x < width / 2 ? 'back' : 'forward';
  const gap = prev ? at - prev.at : Number.NaN;
  if (prev && prev.side === side && gap >= 0 && gap <= DOUBLE_TAP_MS) return { seek: side, memory: null };
  return { seek: null, memory: { at, side } };
};

/** Posição como fração (0–1) da duração, para barras de progresso e de buffer. Sem duração finita, 0. */
export const progressFraction = (position: number, duration: number): number =>
  seekable(duration) && Number.isFinite(position) ? clamp(position / duration, 0, 1) : 0;
