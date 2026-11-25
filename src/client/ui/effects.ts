/** Transição entre telas. Respeita `prefers-reduced-motion`. */
const calm = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Troca o conteúdo da tela com a View Transitions API: a tela antiga some em fade enquanto a nova entra. Sem
 * suporte (ou com movimento reduzido) a troca é direta, como antes. A promessa resolve quando o DOM novo já
 * está no lugar (não espera a animação terminar), então foco e rolagem não atrasam.
 */
export const swapView = (update: () => void): Promise<void> => {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { updateCallbackDone: Promise<void>; ready?: Promise<void>; finished?: Promise<void> } };
  if (calm() || typeof doc.startViewTransition !== 'function') {
    update();
    return Promise.resolve();
  }
  const transition = doc.startViewTransition(update);
  // Navegar de novo no meio da animação cancela a anterior: `ready`/`finished` rejeitam, e isso é esperado.
  transition.ready?.catch(() => undefined);
  transition.finished?.catch(() => undefined);
  // Erro ao desenhar a tela continua aparecendo no console; só não vira promessa rejeitada sem dono.
  return transition.updateCallbackDone.catch((err: unknown) => console.error(err));
};
