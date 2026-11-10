/**
 * Meta de conclusões por ano. É preferência do navegador, como o ritmo da fila: fica em localStorage e nunca vai
 * ao servidor. Valor lido do armazenamento passa pela mesma validação do campo.
 */
const GOAL_KEY = 'nw:stats-goal';
export const GOAL_MIN = 1;
export const GOAL_MAX = 999;

/** Inteiro entre 1 e 999; qualquer outra coisa (vazio, texto, decimal, fora da faixa) é `null` = sem meta. */
export const parseGoal = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined || !/^\d{1,3}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= GOAL_MIN && n <= GOAL_MAX ? n : null;
};

export const readGoal = (): number | null => {
  try {
    return parseGoal(localStorage.getItem(GOAL_KEY));
  } catch {
    return null;
  }
};

/** `null` apaga a meta. Sem armazenamento (aba privada), a escolha vale só nesta tela. */
export const saveGoal = (goal: number | null): void => {
  try {
    if (goal === null) localStorage.removeItem(GOAL_KEY);
    else localStorage.setItem(GOAL_KEY, String(goal));
  } catch {
    // armazenamento bloqueado: nada a fazer
  }
};
