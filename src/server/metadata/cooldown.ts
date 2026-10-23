export type CooldownResult = { ok: true } | { ok: false; retryAfterSec: number };

export interface Cooldown {
  /** Libera a chamada e marca o instante, ou diz quantos segundos faltam. A janela conta desde a última liberada. */
  tryAcquire: (key: string) => CooldownResult;
}

/** Limite por chave (um título) para um gesto manual. Em memória: um restart zera, o que é aceitável para 60 s. */
export const createCooldown = (windowMs: number, now: () => number = Date.now): Cooldown => {
  const lastAt = new Map<string, number>();
  return {
    tryAcquire(key) {
      const t = now();
      const last = lastAt.get(key);
      if (last !== undefined && t - last < windowMs) {
        return { ok: false, retryAfterSec: Math.ceil((windowMs - (t - last)) / 1000) };
      }
      lastAt.set(key, t);
      return { ok: true };
    },
  };
};
