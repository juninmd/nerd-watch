/**
 * Tabela de rotas do app. Cada tela é um chunk separado, baixado só quando a rota abre (`import()`), então a
 * primeira carga traz a casca e a tela pedida, não as 15 telas. Para criar uma tela: escreva
 * `src/client/<feature>/<nome>-page.tsx` exportando o componente da tela e acrescente uma linha em `PAGES` e em `ROUTES`.
 *
 * Sem DOM neste módulo: `resolveRoute` é testável direto (tests/client/routes.test.ts).
 */
import type { ReactNode } from 'react';
import type { CatalogSource } from '../api/catalog.ts';

/** Elemento React da tela. Quem chama já resolveu os parâmetros do caminho; a query chega crua. */
export type RenderPage = (query: URLSearchParams) => ReactNode;

/** Um carregador por tela. Chamar duas vezes devolve o mesmo módulo (o navegador guarda o chunk). */
const PAGES = {
  home: () => import('../home/home-page.tsx'),
  search: () => import('../catalog/search-page.tsx'),
  title: () => import('../catalog/title-page.tsx'),
  publicDomain: () => import('../catalog/public-domain-page.tsx'),
  library: () => import('../library/library-page.tsx'),
  lists: () => import('../lists/lists-page.tsx'),
  listDetail: () => import('../lists/list-detail-page.tsx'),
  calendar: () => import('../calendar/calendar-page.tsx'),
  stats: () => import('../stats/stats-page.tsx'),
  channels: () => import('../channels/channels-page.tsx'),
  channel: () => import('../channels/channel-page.tsx'),
  watch: () => import('../player/watch-page.tsx'),
  play: () => import('../player/episode-play-page.tsx'),
  connections: () => import('../connections/connections-page.tsx'),
  data: () => import('../connections/data-page.tsx'),
  credentials: () => import('../credentials/credentials-page.tsx'),
  settings: () => import('./settings-page.tsx'),
  addons: () => import('../addons/addons-page.tsx'),
  discover: () => import('../addons/discover-page.tsx'),
  addonBrowse: () => import('../addons/addon-browse-page.tsx'),
  addonItem: () => import('../addons/addon-item-page.tsx'),
  tvmazePerson: () => import('../catalog/person-page.tsx'),
  commons: () => import('../catalog/commons-page.tsx'),
} as const;

export type RouteId = keyof typeof PAGES;

export interface RouteDef {
  id: RouteId;
  /** Casa o caminho inteiro (sem query). Os grupos viram `params`, ainda codificados. */
  pattern: RegExp;
  open: (params: string[]) => Promise<RenderPage>;
}

const param = (params: string[], i: number): string => decodeURIComponent(params[i] ?? '');

export const ROUTES: readonly RouteDef[] = [
  {
    id: 'home',
    pattern: /^\/$/,
    open: async () => {
      const { HomePage } = await PAGES.home();
      return () => <HomePage />;
    },
  },
  {
    id: 'search',
    pattern: /^\/search$/,
    open: async () => {
      const { SearchPage } = await PAGES.search();
      return (query) => <SearchPage query={query.get('q') ?? ''} />;
    },
  },
  {
    id: 'title',
    pattern: /^\/title\/(tmdb|archive|tvmaze|anilist)\/(movie|tv|_)\/(.+)$/,
    open: async (params) => {
      const { TitlePage } = await PAGES.title();
      return () => (
        <TitlePage source={params[0] as CatalogSource} mediaType={params[1] as 'movie' | 'tv' | '_'} id={param(params, 2)} />
      );
    },
  },
  {
    id: 'publicDomain',
    pattern: /^\/public-domain$/,
    open: async () => {
      const { PublicDomainPage } = await PAGES.publicDomain();
      return () => <PublicDomainPage />;
    },
  },
  {
    id: 'library',
    pattern: /^\/library$/,
    open: async () => {
      const { LibraryPage } = await PAGES.library();
      return (query) => <LibraryPage query={query} />;
    },
  },
  {
    id: 'lists',
    pattern: /^\/lists$/,
    open: async () => {
      const { ListsPage } = await PAGES.lists();
      return () => <ListsPage />;
    },
  },
  {
    id: 'listDetail',
    pattern: /^\/lists\/([^/]+)$/,
    open: async (params) => {
      const { ListDetailPage } = await PAGES.listDetail();
      return () => <ListDetailPage listId={param(params, 0)} />;
    },
  },
  {
    id: 'calendar',
    pattern: /^\/agenda$/,
    open: async () => {
      const { CalendarPage } = await PAGES.calendar();
      return () => <CalendarPage />;
    },
  },
  {
    id: 'stats',
    pattern: /^\/stats$/,
    open: async () => {
      const { StatsPage } = await PAGES.stats();
      return (query) => <StatsPage query={query} />;
    },
  },
  {
    id: 'channels',
    pattern: /^\/telegram$/,
    open: async () => {
      const { ChannelsPage } = await PAGES.channels();
      return (query) => <ChannelsPage query={query} />;
    },
  },
  {
    id: 'channel',
    pattern: /^\/telegram\/(.+)$/,
    open: async (params) => {
      const { ChannelPage } = await PAGES.channel();
      return () => <ChannelPage titleId={param(params, 0)} />;
    },
  },
  {
    id: 'watch',
    pattern: /^\/watch\/([^/]+)\/(\d+|start)$/,
    open: async (params) => {
      const { WatchPage } = await PAGES.watch();
      return (query) => <WatchPage channelId={params[0] as string} messageId={params[1] as string} query={query} />;
    },
  },
  {
    id: 'play',
    pattern: /^\/play\/(tvmaze|tmdb)\/(\d{1,10})\/(\d{1,4})\/(\d{1,5})$/,
    open: async (params) => {
      const { EpisodePlayPage } = await PAGES.play();
      return (query) => (
        <EpisodePlayPage
          source={params[0] as 'tvmaze' | 'tmdb'}
          id={param(params, 1)}
          season={Number(params[2])}
          episode={Number(params[3])}
          query={query}
        />
      );
    },
  },
  {
    id: 'connections',
    pattern: /^\/connections$/,
    open: async () => {
      const { ConnectionsPage } = await PAGES.connections();
      return (query) => <ConnectionsPage query={query} />;
    },
  },
  {
    id: 'data',
    pattern: /^\/data$/,
    open: async () => {
      const { DataPage } = await PAGES.data();
      return (query) => <DataPage query={query} />;
    },
  },
  {
    id: 'credentials',
    pattern: /^\/credentials$/,
    open: async () => {
      const { CredentialsPage } = await PAGES.credentials();
      return () => <CredentialsPage />;
    },
  },
  {
    id: 'addons',
    pattern: /^\/addons$/,
    open: async () => {
      const { AddonsPage } = await PAGES.addons();
      return () => <AddonsPage />;
    },
  },
  {
    id: 'discover',
    pattern: /^\/descobrir$/,
    open: async () => {
      const { DiscoverPage } = await PAGES.discover();
      return () => <DiscoverPage />;
    },
  },
  {
    id: 'addonBrowse',
    pattern: /^\/addons\/([^/]+)$/,
    open: async (params) => {
      const { AddonBrowsePage } = await PAGES.addonBrowse();
      return () => <AddonBrowsePage addonId={param(params, 0)} />;
    },
  },
  {
    id: 'addonItem',
    pattern: /^\/addons\/([^/]+)\/([^/]+)\/(.+)$/,
    open: async (params) => {
      const { AddonItemPage } = await PAGES.addonItem();
      return () => <AddonItemPage addonId={param(params, 0)} type={param(params, 1)} itemId={param(params, 2)} />;
    },
  },
  {
    id: 'tvmazePerson',
    pattern: /^\/person\/tvmaze\/(\d{1,10})$/,
    open: async (params) => {
      const { TvmazePersonPage } = await PAGES.tvmazePerson();
      return () => <TvmazePersonPage id={param(params, 0)} />;
    },
  },
  {
    id: 'commons',
    pattern: /^\/commons\/(.+)$/,
    open: async (params) => {
      const { CommonsPage } = await PAGES.commons();
      return () => <CommonsPage title={param(params, 0)} />;
    },
  },
  {
    id: 'settings',
    pattern: /^\/settings$/,
    open: async () => {
      const { SettingsPage } = await PAGES.settings();
      return () => <SettingsPage />;
    },
  },
];

/** Rotas antigas continuam funcionando (favoritos e links salvos). */
const ALIASES: Record<string, string> = { '/my-list': '/library', '/calendar': '/agenda' };

export const canonicalPath = (path: string): string => ALIASES[path] ?? path;

export interface RouteMatch {
  def: RouteDef;
  params: string[];
}

/** Rota do caminho já canônico; `null` = página não encontrada. */
export const resolveRoute = (path: string): RouteMatch | null => {
  for (const def of ROUTES) {
    const m = path.match(def.pattern);
    if (m) return { def, params: m.slice(1) };
  }
  return null;
};

/**
 * Baixa em segundo plano os chunks das outras telas, um por vez, para a navegação seguinte não esperar a rede.
 * Falha de rede aqui é silenciosa: a tela tenta de novo quando for aberta de verdade.
 */
export const preloadPages = async (): Promise<void> => {
  for (const load of Object.values(PAGES)) await load().catch(() => undefined);
};
