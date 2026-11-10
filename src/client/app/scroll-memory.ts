/**
 * Posição de rolagem por rota. Só voltar/avançar restaura: um link novo começa no topo.
 * O estado da entrada do histórico (`history.state`) é o que diferencia as duas coisas.
 */
const STORAGE_PREFIX = 'nw.scroll:';
const RESTORE_TIMEOUT_MS = 3000;

export const readScroll = (key: string): number => {
  try {
    const y = Number(sessionStorage.getItem(STORAGE_PREFIX + key));
    return Number.isFinite(y) && y > 0 ? y : 0;
  } catch {
    // sessionStorage bloqueado (modo privado, cota): sem restauração, sem erro
    return 0;
  }
};

export const writeScroll = (key: string, y: number): void => {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(Math.max(0, Math.round(y))));
  } catch {
    // só conveniência: perder a posição não quebra a navegação
  }
};

/** Verdadeiro quando a entrada atual foi marcada para esta rota, ou seja, o usuário voltou/avançou para ela. */
export const isRevisit = (state: unknown, key: string): boolean => (state as { nwKey?: unknown } | null)?.nwKey === key;

export const stampRoute = (key: string): void => {
  try {
    history.replaceState({ nwKey: key }, '');
  } catch {
    // history bloqueado: a volta cai no comportamento de topo
  }
};

/** Dá para ir até `y` com a altura de conteúdo já renderizada. */
export const canReach = (y: number, scrollHeight: number, viewportHeight: number): boolean => scrollHeight - viewportHeight >= y;

/**
 * Restaura `y` assim que o conteúdo tiver altura (listas carregam pela API). Para ao alcançar ou ao expirar o prazo,
 * para não rolar sozinho depois que o usuário já mexeu na página.
 */
export const restoreWhenRendered = (host: HTMLElement, y: number): (() => void) => {
  if (y <= 0) return () => {};
  let done = false;
  const finish = () => {
    done = true;
    observer.disconnect();
    clearTimeout(timer);
  };
  const attempt = () => {
    if (done) return;
    window.scrollTo(0, y);
    if (canReach(y, document.documentElement.scrollHeight, window.innerHeight)) finish();
  };
  const observer = new MutationObserver(attempt);
  observer.observe(host, { childList: true, subtree: true });
  const timer = setTimeout(finish, RESTORE_TIMEOUT_MS);
  attempt();
  return finish;
};
