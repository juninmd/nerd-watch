/**
 * Porteiro de atualizações: evita duas rodadas ao mesmo tempo e limita as automáticas a uma a cada `minIntervalMs`.
 * O clique manual (`force`) ignora o intervalo, mas nunca roda por cima de outra rodada em andamento.
 */
export interface RefreshGate {
  /** `true` se pode começar agora; já marca a rodada como em andamento. */
  tryStart(force?: boolean): boolean;
  /** Chamar ao fim da rodada (sucesso ou falha): libera a próxima e reinicia a contagem do intervalo. */
  finish(): void;
  readonly busy: boolean;
}

export const createRefreshGate = (minIntervalMs: number, now: () => number = Date.now): RefreshGate => {
  let running = false;
  let last = Number.NEGATIVE_INFINITY;
  return {
    tryStart(force = false) {
      if (running) return false;
      if (!force && now() - last < minIntervalMs) return false;
      running = true;
      return true;
    },
    finish() {
      running = false;
      last = now();
    },
    get busy() {
      return running;
    },
  };
};
