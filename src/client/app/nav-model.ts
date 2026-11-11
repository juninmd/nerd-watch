import type { IconName } from '../ui/icons.ts';

/** Menu lateral vertical: grupos por intenção. Sem DOM, para o teste conferir rotas, ativos e atalhos. */
export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Letra do atalho "g + letra" (o mesmo mapa vive em shortcut-keys.ts). */
  key: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Assistir',
    items: [
      { path: '/', label: 'Início', icon: 'home', key: 'h' },
      { path: '/library', label: 'Biblioteca', icon: 'library', key: 'b' },
      { path: '/lists', label: 'Listas', icon: 'bookmark', key: 'l' },
      { path: '/agenda', label: 'Agenda', icon: 'calendar', key: 'a' },
      { path: '/stats', label: 'Estatísticas', icon: 'chart', key: 'e' },
    ],
  },
  {
    label: 'Descobrir',
    items: [
      { path: '/search', label: 'Buscar títulos', icon: 'search', key: 's' },
      { path: '/public-domain', label: 'Domínio público', icon: 'film', key: 'p' },
    ],
  },
  {
    label: 'Fontes de vídeo',
    items: [
      { path: '/telegram', label: 'Canais e player', icon: 'send', key: 't' },
      { path: '/connections', label: 'Conexões', icon: 'plug', key: 'c' },
    ],
  },
  {
    label: 'Conta e dados',
    items: [
      { path: '/data', label: 'Importar e backup', icon: 'database', key: 'd' },
      { path: '/settings', label: 'Ajustes e avisos', icon: 'sliders', key: 'j' },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Detalhe do título e listas pertencem à Biblioteca; o player pertence aos Canais. */
export const isNavActive = (item: NavItem, activePath: string): boolean => {
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
