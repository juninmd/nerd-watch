import { goKeys, NAV_ITEMS } from './nav-model.ts';

/** Destinos do atalho "g + letra" (estilo GitHub). A paleta de comandos mostra as mesmas teclas. */
export const GO_KEYS: Record<string, string> = goKeys();

/** Rótulo da paleta de comandos para a tela: ⌘K em Mac/iOS (onde o Ctrl não existe), Ctrl K no resto. */
export const paletteKeyLabel = (platform: string): string => (/mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K');

/** Linhas da ajuda de atalhos (`?`): deriva a navegação de `NAV_ITEMS` para nunca desatualizar quando entra tela nova. */
export const shortcutHelpRows = (platform: string): Array<[string, string]> => [
  [`${paletteKeyLabel(platform)}  ou  /`, 'paleta de comandos'],
  ...NAV_ITEMS.map((item): [string, string] => [`g  ${item.key}`, item.label]),
  ['v', 'tema: escuro, claro, sistema'],
  ['espaço  k', 'player: reproduzir / pausar'],
  ['j  l', 'player: voltar / avançar 10 s'],
  ['←  →', 'player: voltar / avançar 5 s'],
  ['↑  ↓', 'player: volume'],
  ['0 … 9', 'player: ir para 0% … 90%'],
  ['m  f  c', 'player: mudo, tela cheia, legendas'],
  ['<  >', 'player: velocidade menor / maior'],
  ['n', 'player: próximo vídeo'],
  ['?', 'esta ajuda'],
];

export type KeyOutcome =
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'theme' }
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
    case 'v':
      return { kind: 'theme' };
    case 'g':
      return { kind: 'pending' };
    default:
      return { kind: 'none' };
  }
};
