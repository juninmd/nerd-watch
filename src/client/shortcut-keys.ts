/** Destinos do atalho "g + letra" (estilo GitHub). A paleta de comandos mostra as mesmas teclas. */
export const GO_KEYS: Record<string, string> = { h: '/', b: '/library', t: '/telegram', a: '/agenda', c: '/connections' };

export type KeyOutcome =
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'spoilers' }
  | { kind: 'go'; path: string }
  | { kind: 'pending' }
  | { kind: 'none' };

/**
 * Decide o que uma tecla significa dado o prefixo "g" pendente. Pura (sem DOM) para ser testável:
 * quem chama cuida de ignorar teclas dentro de campos de texto e diálogos abertos.
 */
export const resolveKey = (key: string, gPending: boolean, ctrlOrMeta = false): KeyOutcome => {
  if (ctrlOrMeta) return key.toLowerCase() === 'k' ? { kind: 'palette' } : { kind: 'none' };
  if (gPending) {
    const path = GO_KEYS[key];
    return path ? { kind: 'go', path } : { kind: 'none' };
  }
  switch (key) {
    case '/':
      return { kind: 'palette' };
    case '?':
      return { kind: 'help' };
    case 's':
      return { kind: 'spoilers' };
    case 'g':
      return { kind: 'pending' };
    default:
      return { kind: 'none' };
  }
};
