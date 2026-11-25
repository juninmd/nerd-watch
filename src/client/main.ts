import { getTelegramSettings } from './api/telegram.ts';
import { swapView } from './ui/effects.ts';
import { openCommandPalette } from './app/command-palette.ts';
import { releaseTorrentPlayers } from './player/torrent-player.tsx';
import { paletteKeyLabel } from './app/shortcut-keys.ts';
import { navigate, onRouteChange, type Route } from './app/router.ts';
import { canonicalPath, preloadPages, resolveRoute } from './app/routes.tsx';
import { routeLabel, routeTitle } from './app/route-meta.ts';
import { isRevisit, readScroll, restoreWhenRendered, stampRoute, writeScroll } from './app/scroll-memory.ts';
import { parkPlayer, stopIfOnPage } from './player/player-dock.ts';
import { installShortcuts } from './app/shortcuts.ts';
import { readNavCompact, writeNavCompact } from './app/nav-model.ts';
import { createShellStore } from './app/shell-store.ts';
import { commitShell, mountShell } from './app/shell.tsx';
import { loadErrorPage, notFoundPage } from './app/route-fallback.tsx';
import { getThemePref, installTheme, nextThemePref, onThemeChange, setThemePref } from './app/theme.ts';
import { logout } from './app/logout.ts';
import { health } from './api/index.ts';
import { rememberLoginHash, takeLoginHash, withLoginRedirect } from './app/auth-redirect.ts';
import { registerShellWorker } from './pwa/register.ts';
import { installDesktopBridge } from './platform/tauri.ts';
import { canShareAppLink, copyCurrentScreenLink } from './app/share-link.ts';

// Tema antes de tudo: sem clarão do tema errado na primeira pintura.
installTheme();

// Desktop: frontend embutido, `/api` por IPC e links no navegador. No navegador não faz nada.
installDesktopBridge();

// Volta para a rota que pediu login (link de vídeo com `?t=`), antes de o roteador ler o hash.
try {
  const loginHash = takeLoginHash(sessionStorage);
  // `replaceState` não dispara um hashchange extra: o roteador lê o hash restaurado na primeira carga.
  if (loginHash) history.replaceState(null, '', loginHash);
} catch {
  // sem sessionStorage: segue no início
}

// Sem ACCESS_TOKEN o servidor nunca responde 401, então este wrapper não muda nada no modo local.
globalThis.fetch = withLoginRedirect(globalThis.fetch.bind(globalThis), location.href, (href) => {
  try {
    rememberLoginHash(sessionStorage, location.hash);
  } catch {
    // sem sessionStorage: o login continua, só perde o ponto de retorno
  }
  location.replace(href);
}) as typeof fetch;

const app = document.getElementById('app');
if (!app) throw new Error('#app não encontrado');

const store = createShellStore({
  activePath: canonicalPath(location.hash.replace(/^#/, '').split('?')[0] || '/'),
  drawerOpen: false,
  compact: readNavCompact(),
  theme: getThemePref(),
  showLogout: false,
  connected: null,
  account: null,
  page: null,
  routeKey: '',
});

/**
 * Gaveta no celular: o mesmo menu vertical desliza da esquerda. No desktop o botão some e a gaveta nunca "abre".
 * `compact` é a preferência de desktop (só ícones), guardada em nav-model.ts.
 */
const setDrawer = (open: boolean): void => {
  store.set({ drawerOpen: open });
  document.body.classList.toggle('drawer-open', open);
};

mountShell(app, {
  store,
  paletteKey: paletteKeyLabel(navigator.platform),
  // No desktop não há origem web para um link abrir: o botão sairia da tela sem ter o que copiar.
  canShare: canShareAppLink(),
  actions: {
    navigate: (path) => {
      setDrawer(false);
      navigate(path);
    },
    toggleCompact: () => {
      const compact = !store.get().compact;
      writeNavCompact(compact);
      store.set({ compact });
    },
    setDrawer,
    toggleTheme: () => setThemePref(nextThemePref(getThemePref())),
    logout: () => void logout(),
    openPalette: openCommandPalette,
    copyLink: copyCurrentScreenLink,
  },
});

const viewEl = document.getElementById('view') as HTMLElement;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && store.get().drawerOpen) setDrawer(false);
});

onThemeChange(() => store.set({ theme: getThemePref() }));

// "Sair" só aparece quando o servidor exige token (sem token não há sessão para encerrar).
void health()
  .then((h) => store.set({ showLogout: h.accessEnabled }))
  .catch(() => undefined);

/**
 * Status do Telegram na barra superior. Leitura barata (sem falar com o Telegram); a verificação real fica em Conexões.
 * Outras telas avisam com `window.dispatchEvent(new Event('nw:connection-changed'))` depois de entrar/sair do Telegram. */
const refreshConnectionPill = (): void => {
  getTelegramSettings()
    .then((s) => store.set({ connected: s.personalConfigured, account: s.personalAccount }))
    .catch(() => store.set({ connected: null, account: null }));
};
window.addEventListener('nw:connection-changed', refreshConnectionPill);
refreshConnectionPill();

installShortcuts();

const announcerEl = document.getElementById("route-announcer") as HTMLElement;
let currentKey: string | null = null;
let stopRestore: (() => void) | null = null;
/** Só a navegação mais recente desenha: um chunk que chega atrasado não pisa na tela que o usuário já abriu. */
let navSeq = 0;

/** Depois de trocar de tela o foco vai ao título da página, e o nome da rota é anunciado a leitores de tela. */
const focusRouteHeading = (path: string, query: URLSearchParams) => {
  const heading = viewEl.querySelector<HTMLElement>("h1");
  if (heading) heading.tabIndex = -1;
  (heading ?? viewEl).focus({ preventScroll: true });
  announcerEl.textContent = routeLabel(path, query);
};

const dispatch = async (route: Route, key: string, revisit: boolean): Promise<void> => {
  const seq = ++navSeq;
  setDrawer(false);
  const path = canonicalPath(route.path);
  const match = resolveRoute(path);
  // Fecha torrents (e mata os pollers) da tela anterior antes de trocar de view.
  releaseTorrentPlayers();
  // O vídeo só sobrevive fora da tela de reprodução se o usuário minimizou; senão encerra (e guarda a posição).
  parkPlayer();
  if (match?.def.id !== "watch") stopIfOnPage();
  document.title = routeTitle(path, route.query);

  const page = match ? await match.def.open(match.params).catch(() => loadErrorPage) : notFoundPage;
  if (seq !== navSeq) return;

  await swapView(() => {
    // O menu muda junto com a tela, dentro da transição: é o que faz o destaque deslizar de um item ao outro.
    commitShell(store, { activePath: path, page: page(route.query), routeKey: key });
    focusRouteHeading(path, route.query);
    if (revisit) stopRestore = restoreWhenRendered(viewEl, readScroll(key));
    else window.scrollTo(0, 0);
  });
};

let firstRoute = true;

onRouteChange((route) => {
  const key = location.hash.replace(/^#/, "") || "/";
  const revisit = isRevisit(history.state, key);
  if (currentKey !== null) writeScroll(currentKey, window.scrollY);
  currentKey = key;
  stampRoute(key);
  stopRestore?.();
  stopRestore = null;
  void dispatch(route, key, revisit).then(() => {
    if (!firstRoute) return;
    firstRoute = false;
    // Com a primeira tela no ar, o tempo ocioso baixa as outras: navegar depois não espera a rede.
    (window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1200)))(() => void preloadPages());
  });
});

void registerShellWorker();
