/** Tema do app: escuro (padrão), claro ou o do sistema. A lógica pura fica separada do DOM para ser testável. */
export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'nerd-watch:theme';
export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light', 'system'];
export const THEME_LABEL: Record<ThemePref, string> = { dark: 'Escuro', light: 'Claro', system: 'Sistema' };
/** Cor da barra do navegador (PWA/mobile) em cada tema; bate com `--bg` de tokens.css. */
export const THEME_COLOR: Record<Theme, string> = { dark: '#0a0b12', light: '#eeedf6' };

export const parseThemePref = (raw: string | null | undefined): ThemePref => (THEME_PREFS.includes(raw as ThemePref) ? (raw as ThemePref) : 'dark');

export const resolveTheme = (pref: ThemePref, systemDark: boolean): Theme => (pref === 'system' ? (systemDark ? 'dark' : 'light') : pref);

/** Ciclo do botão da barra: escuro → claro → sistema → escuro. */
export const nextThemePref = (pref: ThemePref): ThemePref => THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length] as ThemePref;

type Listener = (pref: ThemePref) => void;
const listeners = new Set<Listener>();

export const getThemePref = (): ThemePref => {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
};

const systemQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)');

const apply = (pref: ThemePref): void => {
  const theme = resolveTheme(pref, systemQuery().matches);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
};

export const setThemePref = (pref: ThemePref): void => {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* modo privado: o tema vale só nesta sessão */
  }
  apply(pref);
  for (const l of listeners) l(pref);
};

export const onThemeChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Aplica o tema salvo e acompanha o sistema quando a preferência é "Sistema". */
export const installTheme = (): void => {
  apply(getThemePref());
  systemQuery().addEventListener('change', () => {
    if (getThemePref() === 'system') apply('system');
  });
};
