/**
 * Modelo do menu lateral: grupos, itens e qual item está ativo. Sem DOM, para testar direto
 * (tests/client/nav-model.test.ts). `main.ts` só desenha o que sai daqui.
 */
import type { IconName } from "../ui/icons.ts";

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  /** Aparece na barra inferior do celular; os demais ficam atrás de "Menu". */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Assistir",
    items: [
      { path: "/", label: "Início", icon: "home", primary: true },
      { path: "/library", label: "Biblioteca", icon: "library", primary: true },
      { path: "/lists", label: "Listas", icon: "list" },
      { path: "/agenda", label: "Agenda", icon: "calendar", primary: true },
      { path: "/stats", label: "Estatísticas", icon: "chart" },
    ],
  },
  {
    label: "Descobrir",
    items: [
      { path: "/search", label: "Buscar", icon: "search", primary: true },
      { path: "/public-domain", label: "Domínio público", icon: "globe" },
    ],
  },
  {
    label: "Fontes de vídeo",
    items: [
      { path: "/telegram", label: "Canais", icon: "send", primary: true },
      { path: "/connections", label: "Conexões", icon: "sliders" },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Telas filhas contam como o item da família: título abre a partir da Biblioteca, player a partir de Canais. */
export const isNavActive = (item: Pick<NavItem, "path">, activePath: string): boolean => {
  if (item.path === "/") return activePath === "/";
  if (item.path === "/library") return activePath.startsWith("/library") || activePath.startsWith("/title/");
  if (item.path === "/telegram") return activePath.startsWith("/telegram") || activePath.startsWith("/watch");
  return activePath === item.path || activePath.startsWith(`${item.path}/`);
};

const COMPACT_KEY = "nw:nav-compact";

/** Preferência de menu compacto (só ícones). Sem localStorage (modo privado), vale só a sessão. */
export const readNavCompact = (storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean => {
  try {
    return storage?.getItem(COMPACT_KEY) === "1";
  } catch {
    return false;
  }
};

export const writeNavCompact = (
  value: boolean,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void => {
  try {
    storage?.setItem(COMPACT_KEY, value ? "1" : "0");
  } catch {
    /* preferência dura só a sessão */
  }
};
