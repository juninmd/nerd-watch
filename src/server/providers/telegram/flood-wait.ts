import type { Context } from 'hono';
import { errors } from 'teleproto';

/**
 * Espera máxima dentro de uma requisição HTTP. Acima disso o Telegram manda o cliente esperar mais do que a UI
 * aguenta: devolvemos 429 com `Retry-After` em vez de segurar a conexão.
 */
export const FLOOD_WAIT_MAX_SECONDS = 30;

export class TelegramFloodWaitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`o Telegram pediu espera de ${retryAfterSeconds} s — tente de novo depois`);
    this.name = 'TelegramFloodWaitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const WIRE_FLOOD = /^FLOOD_(?:PREMIUM_)?WAIT_(\d+)$/;

/** Segundos pedidos em FLOOD_WAIT_x / FLOOD_PREMIUM_WAIT_x, ou null se o erro não for flood wait. */
export const floodWaitSeconds = (err: unknown): number | null => {
  if (err instanceof errors.FloodWaitError) return err.seconds;
  if (typeof err !== 'object' || err === null || !('errorMessage' in err)) return null;
  const m = WIRE_FLOOD.exec(String(err.errorMessage));
  return m?.[1] !== undefined ? Number(m[1]) : null;
};

export interface FloodWaitOptions {
  maxWaitSeconds?: number;
  /** Injetado: teste não dorme de verdade. Padrão: `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Roda `fn` e, se o Telegram pedir espera curta, espera e tenta UMA vez de novo. Espera longa, ou um segundo flood
 * wait, viram `TelegramFloodWaitError` (com o tempo para tentar de novo). Não há laço: no máximo duas chamadas
 * e uma espera. Só usar com leituras: `fn` pode rodar duas vezes.
 */
export const withFloodWait = async <T>(fn: () => Promise<T>, opts: FloodWaitOptions = {}): Promise<T> => {
  const max = opts.maxWaitSeconds ?? FLOOD_WAIT_MAX_SECONDS;
  const sleep = opts.sleep ?? defaultSleep;
  try {
    return await fn();
  } catch (err) {
    const first = floodWaitSeconds(err);
    if (first === null) throw err;
    if (first > max) throw new TelegramFloodWaitError(first);
    await sleep(first * 1000);
  }
  try {
    return await fn();
  } catch (err) {
    const again = floodWaitSeconds(err);
    if (again === null) throw err;
    throw new TelegramFloodWaitError(again);
  }
};

/** Resposta HTTP para flood wait que passou do teto: 429 e o tempo de espera em `Retry-After`. */
export const floodWaitResponse = (c: Context, err: TelegramFloodWaitError) =>
  c.json({ error: err.message }, 429, { 'Retry-After': String(err.retryAfterSeconds) });
