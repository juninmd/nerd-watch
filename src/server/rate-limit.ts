/**
 * Janela deslizante para respeitar o limite documentado de uma API pública. Quando o limite é atingido, a
 * chamada falha na hora (não espera): o chamador devolve a mensagem nossa de "tente de novo" em vez de
 * segurar a requisição do navegador ou estourar a cota do serviço.
 */
export class RateLimitExceededError extends Error {
  constructor(public readonly service: string) {
    super(`${service}: limite de requisições atingido, tente de novo em instantes`);
    this.name = 'RateLimitExceededError';
  }
}

export interface RateLimiter {
  /** Registra uma chamada ou lança `RateLimitExceededError` se a janela já estiver cheia. */
  acquire(): void;
  /** Só para testes: esvazia a janela. */
  reset(): void;
}

export const createRateLimiter = (service: string, max: number, windowMs: number, now: () => number = Date.now): RateLimiter => {
  let stamps: number[] = [];
  return {
    acquire() {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) throw new RateLimitExceededError(service);
      stamps.push(t);
    },
    reset() {
      stamps = [];
    },
  };
};
