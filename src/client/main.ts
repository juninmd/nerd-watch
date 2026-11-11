import { getTelegramSettings } from './api/telegram.ts';
import { escapeHtml } from './ui/card.ts';
import { installCardTilt, swapView } from './ui/effects.ts';
import { openCommandPalette } from './app/command-palette.ts';
import { releaseTorrentPlayers } from './player/torrent-player.ts';
import { icon } from './ui/icons.ts';
import { paletteKeyLabel } from './app/shortcut-keys.ts';
import { onRouteChange, type Route } from './app/router.ts';
import { canonicalPath, preloadPages, resolveRoute } from './app/routes.ts';
import { routeLabel, routeTitle } from './app/route-meta.ts';
import { isRevisit, readScroll, restoreWhenRendered, stampRoute, writeScroll } from './app/scroll-memory.ts';
import { mountPlayerDock, parkPlayer, stopIfOnPage } from './player/player-dock.ts';
import { installShortcuts } from './app/shortcuts.ts';
import { NAV_GROUPS, isNavActive } from './app/nav-model.ts';
import { getThemePref, installTheme, nextThemePref, onThemeChange, setThemePref, THEME_LABEL } from './app/theme.ts';
import { logout } from './app/logout.ts';
import { health } from './api/index.ts';
import { getShowSpoilers, onSpoilerChange, setShowSpoilers } from './app/state.ts';
import { withLoginRedirect } from './app/auth-redirect.ts';
import { registerShellWorker } from './pwa/register.ts';
import { installDesktopBridge } from './platform/tauri.ts';

// Tema antes de tudo: sem clarão do tema errado na primeira pintura.
installTheme();

// Desktop: frontend embutido, `/api` por IPC e links no navegador. No navegador não faz nada.
installDesktopBridge();

// Sem ACCESS_TOKEN o servidor nunca responde 401, então este wrapper não muda nada no modo local.
globalThis.fetch = withLoginRedirect(globalThis.fetch.bind(globalThis), location.href, (href) =>
  location.replace(href),
) as typeof fetch;

const app = document.getElementById('app');
if (!app) throw new Error('#app não encontrado');

app.innerHTML = `
  <a class="skip" href="#view">pular para o conteúdo</a>
  <div class="shell">
    <aside class="navrail" id="sidebar" aria-label="menu lateral">
      <div class="side-brand"><span class="brand" aria-hidden="true">${icon('film')}</span><span class="brand-name">nerd-watch</span></div>
      <nav class="nav" id="nav" aria-label="principal"></nav>
      <div class="side-foot">
        <button class="side-btn" id="theme-toggle" type="button"></button>
        <button class="side-btn" id="logout-btn" type="button" hidden>${icon('logout', 'sm')}<span>Sair</span></button>
      </div>
    </aside>
    <div class="drawer-scrim" id="scrim" hidden></div>
    <div class="main">
      <header class="topbar">
        <button class="menu-btn" id="menu-open" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Abrir menu">${icon('menu')}</button>
        <button class="cmd" id="cmd-open" type="button" aria-haspopup="dialog">
          ${icon('search')}<span class="cmd-text">Buscar títulos, canais e ações…</span><kbd>${paletteKeyLabel(navigator.platform)}</kbd>
        </button>
        <button class="pill" id="spoiler-toggle" type="button"></button>
        <a class="pill" id="conn-pill" href="#/connections"></a>
      </header>
      <main id="view" tabindex="-1"></main>
      <div id="route-announcer" class="sr-only" aria-live="polite"></div>
    </div>
  </div>
  <div id="dock"></div>
`;

const navEl = document.getElementById('nav') as HTMLElement;
const viewEl = document.getElementById('view') as HTMLElement;
const spoilerBtn = document.getElementById('spoiler-toggle') as HTMLButtonElement;
const connPill = document.getElementById('conn-pill') as HTMLAnchorElement;

const sidebarEl = document.getElementById('sidebar') as HTMLElement;
const scrimEl = document.getElementById('scrim') as HTMLElement;
const menuBtn = document.getElementById('menu-open') as HTMLButtonElement;

/** Gaveta no celular: o mesmo menu vertical desliza da esquerda. No desktop o botão some e a gaveta nunca "abre". */
const setDrawer = (open: boolean): void => {
  sidebarEl.classList.toggle('is-open', open);
  scrimEl.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('drawer-open', open);
};
menuBtn.addEventListener('click', () => setDrawer(!sidebarEl.classList.contains('is-open')));
scrimEl.addEventListener('click', () => setDrawer(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebarEl.classList.contains('is-open')) setDrawer(false);
});

const renderNav = (activePath: string) => {
  navEl.replaceChildren();
  for (const group of NAV_GROUPS) {
    const section = document.createElement('div');
    section.className = 'nav-group';
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', group.label);
    section.innerHTML = `<div class="nav-label" aria-hidden="true">${group.label}</div>`;
    for (const item of group.items) {
      const a = document.createElement('a');
      a.href = `#${item.path}`;
      const active = isNavActive(item, activePath);
      a.className = `navlink${active ? ' active' : ''}`;
      if (active) a.setAttribute('aria-current', 'page');
      a.title = `${item.label} (g ${item.key})`;
      a.innerHTML = `${icon(item.icon)}<span class="label">${item.label}</span>`;
      a.addEventListener('click', () => setDrawer(false));
      section.appendChild(a);
    }
    navEl.appendChild(section);
  }
};

const themeBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
const THEME_ICON = { dark: 'moon', light: 'sun', system: 'monitor' } as const;
const renderThemeButton = () => {
  const pref = getThemePref();
  themeBtn.setAttribute('aria-label', `Tema: ${THEME_LABEL[pref]}. Alternar tema`);
  themeBtn.innerHTML = `${icon(THEME_ICON[pref], 'sm')}<span>Tema: ${THEME_LABEL[pref]}</span><kbd>v</kbd>`;
};
themeBtn.addEventListener('click', () => setThemePref(nextThemePref(getThemePref())));
onThemeChange(renderThemeButton);
renderThemeButton();

// "Sair" só aparece quando o servidor exige token (sem token não há sessão para encerrar).
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
logoutBtn.addEventListener('click', () => void logout());
void health()
  .then((h) => {
    logoutBtn.hidden = !h.accessEnabled;
  })
  .catch(() => undefined);

const renderSpoilerButton = () => {
  const on = getShowSpoilers();
  // O nome acessível é fixo e o estado vai no aria-pressed: leitores de tela não anunciam "Spoilers visíveis, pressionado".
  spoilerBtn.setAttribute('aria-pressed', String(on));
  spoilerBtn.setAttribute('aria-label', 'Mostrar spoilers');
  const label = on ? 'Spoilers visíveis' : 'Spoilers ocultos';
  spoilerBtn.innerHTML = `${icon(on ? 'eye' : 'eyeOff', 'sm')}<span class="pill-label">${label}</span>`;
};

spoilerBtn.addEventListener('click', () => setShowSpoilers(!getShowSpoilers()));
onSpoilerChange(renderSpoilerButton);
renderSpoilerButton();

/** Status do Telegram na barra superior. Leitura barata (sem falar com o Telegram); a verificação real fica em Conexões. */
const renderConnectionPill = (connected: boolean | null, account: { name: string; avatarUrl: string | null } | null = null) => {
  // Com conta conhecida mostra a foto e o nome logo na barra (ex.: "Telegram · Ana"); sem ela, o rótulo genérico.
  const label = connected === null ? 'Telegram' : connected ? (account ? `Telegram · ${account.name}` : 'Telegram conectado') : 'Telegram desconectado';
  connPill.setAttribute('aria-label', label);
  const photo = connected && account?.avatarUrl ? `<img class="pill-avatar" src="${escapeHtml(account.avatarUrl)}" alt="" width="20" height="20" />` : '';
  connPill.innerHTML = `${photo}<span class="led${connected ? '' : ' off'}"></span><span class="pill-label">${escapeHtml(label)}</span>`;
};
/** Outras telas avisam com `window.dispatchEvent(new Event('nw:connection-changed'))` depois de entrar/sair do Telegram. */
const refreshConnectionPill = (): void => {
  getTelegramSettings()
    .then((s) => renderConnectionPill(s.personalConfigured, s.personalAccount))
    .catch(() => renderConnectionPill(null));
};
window.addEventListener('nw:connection-changed', refreshConnectionPill);
renderConnectionPill(null);
refreshConnectionPill();

document.getElementById('cmd-open')?.addEventListener('click', openCommandPalette);
installShortcuts();
installCardTilt();
mountPlayerDock(document.getElementById('dock') as HTMLElement);

const announcerEl = document.getElementById('route-announcer') as HTMLElement;
let currentKey: string | null = null;
let stopRestore: (() => void) | null = null;
/** Só a navegação mais recente desenha: um chunk que chega atrasado não pisa na tela que o usuário já abriu. */
let navSeq = 0;

/** Depois de trocar de tela o foco vai ao título da página, e o nome da rota é anunciado a leitores de tela. */
const focusRouteHeading = (path: string, query: URLSearchParams) => {
  const heading = viewEl.querySelector<HTMLElement>('h1');
  if (heading) heading.tabIndex = -1;
  (heading ?? viewEl).focus({ preventScroll: true });
  announcerEl.textContent = routeLabel(path, query);
};

const renderNotFound = (host: HTMLElement): void => {
  host.innerHTML = `<div class="empty-state"><div class="big">${icon('search')}</div>página não encontrada <a href="#/">voltar ao início</a></div>`;
};

/** Chunk da tela não baixou (servidor parado, rede caiu): a tela diz o que houve e oferece tentar de novo. */
const renderLoadError = (host: HTMLElement): void => {
  host.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar esta tela <button class="btn btn-ghost btn-sm" type="button" id="route-retry">tentar de novo</button></div>`;
  host.querySelector('#route-retry')?.addEventListener('click', () => window.dispatchEvent(new HashChangeEvent('hashchange')));
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
  if (match?.def.id !== 'watch') stopIfOnPage();
  document.title = routeTitle(path, route.query);
  // Primeira carga: o menu aparece já, sem esperar o chunk da tela.
  if (!navEl.hasChildNodes()) renderNav(path);

  const render = match ? await match.def.open(match.params).catch(() => renderLoadError) : renderNotFound;
  if (seq !== navSeq) return;

  await swapView(() => {
    // O menu muda junto com a tela, dentro da transição: é o que faz o destaque deslizar de um item ao outro.
    renderNav(path);
    render(viewEl, route.query);
    focusRouteHeading(path, route.query);
    if (revisit) stopRestore = restoreWhenRendered(viewEl, readScroll(key));
    else window.scrollTo(0, 0);
  });
};

let firstRoute = true;

onRouteChange((route) => {
  const key = location.hash.replace(/^#/, '') || '/';
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
