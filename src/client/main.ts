import { getTelegramSettings } from './api.ts';
import { openCommandPalette } from './components/command-palette.ts';
import { releaseTorrentPlayers } from './components/torrent-player.ts';
import { icon, type IconName } from './icons.ts';
import { onRouteChange, type Route } from './router.ts';
import { installShortcuts } from './shortcuts.ts';
import { getShowSpoilers, onSpoilerChange, setShowSpoilers } from './state.ts';
import { renderCalendar } from './views/calendar.ts';
import { renderConnections } from './views/connections.ts';
import { renderDiscover } from './views/discover.ts';
import { renderMyList } from './views/my-list.ts';
import { renderPublicDomain } from './views/public-domain.ts';
import { renderSearch } from './views/search.ts';
import { renderTelegramChannel } from './views/telegram-channel.ts';
import { renderTelegramChannels } from './views/telegram-channels.ts';
import { renderTitleDetail } from './views/media-detail.ts';

const NAV_ITEMS: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '/', label: 'Início', icon: 'home' },
  { path: '/library', label: 'Biblioteca', icon: 'library' },
  { path: '/telegram', label: 'Telegram', icon: 'send' },
  { path: '/agenda', label: 'Agenda', icon: 'calendar' },
  { path: '/connections', label: 'Conexões', icon: 'sliders' },
];

/** Rotas antigas continuam funcionando (favoritos, links em views ainda não migradas). */
const ALIASES: Record<string, string> = { '/my-list': '/library', '/calendar': '/agenda' };

const app = document.getElementById('app');
if (!app) throw new Error('#app não encontrado');

app.innerHTML = `
  <a class="skip" href="#view">pular para o conteúdo</a>
  <div class="shell">
    <nav class="navrail" id="nav" aria-label="principal"></nav>
    <div class="main">
      <header class="topbar">
        <button class="cmd" id="cmd-open" type="button" aria-haspopup="dialog">
          ${icon('search')}<span class="cmd-text">Buscar títulos, canais e ações…</span><kbd>Ctrl K</kbd>
        </button>
        <button class="pill" id="spoiler-toggle" type="button"></button>
        <a class="pill" id="conn-pill" href="#/connections"></a>
      </header>
      <main id="view" tabindex="-1"></main>
    </div>
  </div>
`;

const navEl = document.getElementById('nav') as HTMLElement;
const viewEl = document.getElementById('view') as HTMLElement;
const spoilerBtn = document.getElementById('spoiler-toggle') as HTMLButtonElement;
const connPill = document.getElementById('conn-pill') as HTMLAnchorElement;

const isActive = (item: { path: string }, activePath: string): boolean => {
  if (item.path === '/') return activePath === '/';
  if (item.path === '/library') return activePath.startsWith('/library') || activePath.startsWith('/title/');
  return activePath.startsWith(item.path);
};

const renderNav = (activePath: string) => {
  navEl.innerHTML = `<div class="brand" aria-hidden="true">${icon('film')}</div>`;
  for (const item of NAV_ITEMS) {
    const a = document.createElement('a');
    a.href = `#${item.path}`;
    a.className = `navlink${isActive(item, activePath) ? ' active' : ''}`;
    if (isActive(item, activePath)) a.setAttribute('aria-current', 'page');
    a.innerHTML = `${icon(item.icon)}<span class="label">${item.label}</span>`;
    navEl.appendChild(a);
  }
};

const renderSpoilerButton = () => {
  const on = getShowSpoilers();
  spoilerBtn.setAttribute('aria-pressed', String(on));
  const label = on ? 'Spoilers visíveis' : 'Spoilers ocultos';
  spoilerBtn.setAttribute('aria-label', label);
  spoilerBtn.innerHTML = `${icon(on ? 'eye' : 'eyeOff', 'sm')}<span class="pill-label">${label}</span>`;
};

spoilerBtn.addEventListener('click', () => setShowSpoilers(!getShowSpoilers()));
onSpoilerChange(renderSpoilerButton);
renderSpoilerButton();

/** Status do Telegram na barra superior. Leitura barata (sem falar com o Telegram); a verificação real fica em Conexões. */
const renderConnectionPill = (connected: boolean | null) => {
  const label = connected === null ? 'Telegram' : connected ? 'Telegram conectado' : 'Telegram desconectado';
  connPill.setAttribute('aria-label', label);
  connPill.innerHTML = `<span class="led${connected ? '' : ' off'}"></span><span class="pill-label">${label}</span>`;
};
/** Outras telas avisam com `window.dispatchEvent(new Event('nw:connection-changed'))` depois de entrar/sair do Telegram. */
const refreshConnectionPill = (): void => {
  getTelegramSettings()
    .then((s) => renderConnectionPill(s.personalConfigured))
    .catch(() => renderConnectionPill(null));
};
window.addEventListener('nw:connection-changed', refreshConnectionPill);
renderConnectionPill(null);
refreshConnectionPill();

document.getElementById('cmd-open')?.addEventListener('click', openCommandPalette);
installShortcuts();

const TITLE_RE = /^\/title\/(tmdb|archive)\/(movie|tv|_)\/(.+)$/;
const TELEGRAM_CHANNEL_RE = /^\/telegram\/(.+)$/;

const dispatch = (route: Route) => {
  // Fecha torrents (e mata os pollers) da tela anterior antes de trocar de view.
  releaseTorrentPlayers();
  const path = ALIASES[route.path] ?? route.path;
  renderNav(path);
  const titleMatch = path.match(TITLE_RE);
  if (titleMatch) {
    const [, source, mediaType, id] = titleMatch as unknown as [string, 'tmdb' | 'archive', 'movie' | 'tv' | '_', string];
    renderTitleDetail(viewEl, source, mediaType, decodeURIComponent(id));
    return;
  }
  const telegramMatch = path.match(TELEGRAM_CHANNEL_RE);
  if (telegramMatch) {
    renderTelegramChannel(viewEl, decodeURIComponent(telegramMatch[1] as string));
    return;
  }
  switch (path) {
    case '/':
      renderDiscover(viewEl);
      return;
    case '/search':
      renderSearch(viewEl, route.query.get('q') ?? '');
      return;
    case '/library':
      renderMyList(viewEl);
      return;
    case '/agenda':
      renderCalendar(viewEl);
      return;
    case '/public-domain':
      renderPublicDomain(viewEl);
      return;
    case '/telegram':
      renderTelegramChannels(viewEl, route.query);
      return;
    case '/connections':
      renderConnections(viewEl, route.query);
      return;
    default:
      viewEl.innerHTML = `<div class="empty-state"><div class="big">${icon('search')}</div>página não encontrada <a href="#/">voltar ao início</a></div>`;
  }
};

onRouteChange((route) => {
  dispatch(route);
  window.scrollTo(0, 0);
});
