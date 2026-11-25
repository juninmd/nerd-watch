import type { IconName } from '../ui/icons.ts';

/**
 * Modelo do menu lateral: grupos por intenção, itens, atalhos e qual item está ativo. Sem DOM, para
 * testar direto (tests/client/nav-model.test.ts). `app/shell.tsx` só desenha o que sai daqui.
 */
export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Letra do atalho "g + letra" (o mesmo mapa vive em shortcut-keys.ts). */
  key: string;
  /** Aparece na barra inferior do celular; os demais ficam atrás de "Menu". */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Assistir',
    items: [
      { path: '/', label: 'Início', icon: 'home', key: 'h', primary: true },
      { path: '/library', label: 'Biblioteca', icon: 'library', key: 'b', primary: true },
      { path: '/lists', label: 'Listas', icon: 'bookmark', key: 'l' },
      { path: '/agenda', label: 'Agenda', icon: 'calendar', key: 'a', primary: true },
      { path: '/stats', label: 'Estatísticas', icon: 'chart', key: 'e' },
    ],
  },
  {
    label: 'Descobrir',
    items: [
      { path: '/search', label: 'Buscar títulos', icon: 'search', key: 's', primary: true },
      { path: '/descobrir', label: 'Catálogos dos addons', icon: 'grid', key: 'u' },
      { path: '/public-domain', label: 'Domínio público', icon: 'film', key: 'p' },
    ],
  },
  {
    label: 'Fontes de vídeo',
    items: [
      { path: '/telegram', label: 'Canais e player', icon: 'send', key: 't', primary: true },
      { path: '/connections', label: 'Conexões', icon: 'plug', key: 'c' },
      { path: '/addons', label: 'Addons Stremio', icon: 'puzzle', key: 'o' },
    ],
  },
  {
    label: 'Conta e dados',
    items: [
      { path: '/data', label: 'Importar e backup', icon: 'database', key: 'd' },
      { path: '/credentials', label: 'Credenciais', icon: 'key', key: 'k' },
      { path: '/settings', label: 'Ajustes e avisos', icon: 'sliders', key: 'j' },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Telas filhas contam como o item da família: título abre a partir da Biblioteca, player a partir de Canais. */
export const isNavActive = (item: Pick<NavItem, 'path'>, activePath: string): boolean => {
  if (item.path === '/') return activePath === '/';
  if (item.path === '/library') return activePath.startsWith('/library') || activePath.startsWith('/title/');
  if (item.path === '/telegram') return activePath.startsWith('/telegram') || activePath.startsWith('/watch');
  return activePath === item.path || activePath.startsWith(`${item.path}/`);
};

/** Atalhos "g + letra" derivados do menu, mais os apelidos antigos (`g i` = Início, `g x` = Conexões). */
export const goKeys = (): Record<string, string> => {
  const keys: Record<string, string> = { i: '/', x: '/connections' };
  for (const item of NAV_ITEMS) keys[item.key] = item.path;
  return keys;
};

const COMPACT_KEY = 'nw:nav-compact';

/** Preferência de menu compacto (só ícones). Sem localStorage (modo privado), vale só a sessão. */
export const readNavCompact = (storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean => {
  try {
    return storage?.getItem(COMPACT_KEY) === '1';
  } catch {
    return false;
  }
};

export const writeNavCompact = (
  value: boolean,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void => {
  try {
    storage?.setItem(COMPACT_KEY, value ? '1' : '0');
  } catch {
    /* preferência dura só a sessão */
  }
};
