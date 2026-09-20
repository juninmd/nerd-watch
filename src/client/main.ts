import { navigate, onRouteChange, type Route } from './router.ts';
import { getShowSpoilers, onSpoilerChange, setShowSpoilers } from './state.ts';
import { renderDiscover } from './views/discover.ts';
import { renderSearch } from './views/search.ts';
import { renderMyList } from './views/my-list.ts';
import { renderCalendar } from './views/calendar.ts';
import { renderPublicDomain } from './views/public-domain.ts';
import { renderTitleDetail } from './views/media-detail.ts';
import { renderTelegramChannels } from './views/telegram-channels.ts';
import { renderTelegramChannel } from './views/telegram-channel.ts';

const NAV_ITEMS = [
  { path: '/', label: 'Início', icon: '🏠' },
  { path: '/search', label: 'Buscar', icon: '🔎' },
  { path: '/my-list', label: 'Minha lista', icon: '🗂️' },
  { path: '/calendar', label: 'Calendário', icon: '🗓️' },
  { path: '/public-domain', label: 'Domínio público', icon: '🎞️' },
  { path: '/telegram', label: 'Telegram', icon: '✈️' },
];

const app = document.getElementById('app');
if (!app) throw new Error('#app não encontrado');

app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="mark">🍿</span> nerd-watch</div>
      <nav class="nav" id="nav"></nav>
      <div class="sidebar-footer">local-first · seus dados ficam no seu SQLite</div>
    </aside>
    <div class="main">
      <div class="topbar">
        <form class="search-box" id="topbar-search">
          <span class="icon">🔎</span>
          <input type="search" name="q" placeholder="Buscar filmes, séries, novelas..." autocomplete="off" />
        </form>
        <button class="spoiler-toggle" id="spoiler-toggle" type="button"></button>
      </div>
      <div id="view"></div>
    </div>
  </div>
`;

const navEl = document.getElementById('nav') as HTMLElement;
const viewEl = document.getElementById('view') as HTMLElement;
const spoilerBtn = document.getElementById('spoiler-toggle') as HTMLButtonElement;
const searchForm = document.getElementById('topbar-search') as HTMLFormElement;
const searchInput = searchForm.querySelector('input[name="q"]') as HTMLInputElement;

const renderNav = (activePath: string) => {
  navEl.innerHTML = '';
  for (const item of NAV_ITEMS) {
    const active = item.path === '/' ? activePath === '/' : activePath.startsWith(item.path);
    const a = document.createElement('a');
    a.href = `#${item.path}`;
    a.className = `nav-link${active ? ' active' : ''}`;
    a.innerHTML = `<span class="icon">${item.icon}</span><span class="label">${item.label}</span>`;
    navEl.appendChild(a);
  }
};

const renderSpoilerButton = () => {
  const on = getShowSpoilers();
  spoilerBtn.dataset.on = String(on);
  spoilerBtn.innerHTML = on ? '🙈 spoilers visíveis' : '🙉 spoilers ocultos';
};

spoilerBtn.addEventListener('click', () => setShowSpoilers(!getShowSpoilers()));
onSpoilerChange(renderSpoilerButton);
renderSpoilerButton();

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = new FormData(searchForm).get('q')?.toString().trim() ?? '';
  navigate(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
});

const TITLE_RE = /^\/title\/(tmdb|archive)\/(movie|tv|_)\/(.+)$/;
const TELEGRAM_CHANNEL_RE = /^\/telegram\/(.+)$/;

const dispatch = (route: Route) => {
  renderNav(route.path);
  const titleMatch = route.path.match(TITLE_RE);
  if (titleMatch) {
    const [, source, mediaType, id] = titleMatch as unknown as [string, 'tmdb' | 'archive', 'movie' | 'tv' | '_', string];
    renderTitleDetail(viewEl, source, mediaType, decodeURIComponent(id));
    return;
  }
  const telegramMatch = route.path.match(TELEGRAM_CHANNEL_RE);
  if (telegramMatch) {
    renderTelegramChannel(viewEl, decodeURIComponent(telegramMatch[1] as string));
    return;
  }
  switch (route.path) {
    case '/':
      renderDiscover(viewEl);
      return;
    case '/search':
      renderSearch(viewEl, route.query.get('q') ?? '');
      searchInput.value = route.query.get('q') ?? '';
      return;
    case '/my-list':
      renderMyList(viewEl);
      return;
    case '/calendar':
      renderCalendar(viewEl);
      return;
    case '/public-domain':
      renderPublicDomain(viewEl);
      return;
    case '/telegram':
      renderTelegramChannels(viewEl);
      return;
    default:
      viewEl.innerHTML = '<div class="empty-state"><div class="big">🧭</div>página não encontrada</div>';
  }
};

onRouteChange(dispatch);
