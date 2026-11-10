/**
 * Tabela de rotas do app. Cada tela é um chunk separado, baixado só quando a rota abre (`import()`), então a
 * primeira carga traz a casca e a tela pedida, não as 13 telas. Para criar uma tela: escreva
 * `src/client/<feature>/<nome>-page.ts` exportando `render...` e acrescente uma linha em `PAGES` e em `ROUTES`.
 *
 * Sem DOM neste módulo: `resolveRoute` é testável direto (tests/client/routes.test.ts).
 */
import type { CatalogSource } from '../api/catalog.ts';

/** Desenha a tela no `host`. Quem chama já resolveu os parâmetros do caminho; a query chega crua. */
export type RenderPage = (host: HTMLElement, query: URLSearchParams) => void;

/** Um carregador por tela. Chamar duas vezes devolve o mesmo módulo (o navegador guarda o chunk). */
const PAGES = {
  home: () => import('../home/home-page.ts'),
  search: () => import('../catalog/search-page.ts'),
  title: () => import('../catalog/title-page.ts'),
  publicDomain: () => import('../catalog/public-domain-page.ts'),
  library: () => import('../library/library-page.ts'),
  lists: () => import('../lists/lists-page.ts'),
  listDetail: () => import('../lists/list-detail-page.ts'),
  calendar: () => import('../calendar/calendar-page.ts'),
  stats: () => import('../stats/stats-page.ts'),
  channels: () => import('../channels/channels-page.ts'),
  channel: () => import('../channels/channel-page.ts'),
  watch: () => import('../player/watch-page.ts'),
  connections: () => import('../connections/connections-page.ts'),
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
  { id: 'home', pattern: /^\/$/, open: async () => (await PAGES.home()).renderHome },
  {
    id: 'search',
    pattern: /^\/search$/,
    open: async () => {
      const { renderSearch } = await PAGES.search();
      return (host, query) => renderSearch(host, query.get('q') ?? '');
    },
  },
  {
    id: 'title',
    pattern: /^\/title\/(tmdb|archive|tvmaze|anilist)\/(movie|tv|_)\/(.+)$/,
    open: async (params) => {
      const { renderTitleDetail } = await PAGES.title();
      return (host) => renderTitleDetail(host, params[0] as CatalogSource, params[1] as 'movie' | 'tv' | '_', param(params, 2));
    },
  },
  { id: 'publicDomain', pattern: /^\/public-domain$/, open: async () => (await PAGES.publicDomain()).renderPublicDomain },
  { id: 'library', pattern: /^\/library$/, open: async () => (await PAGES.library()).renderLibrary },
  { id: 'lists', pattern: /^\/lists$/, open: async () => (await PAGES.lists()).renderLists },
  {
    id: 'listDetail',
    pattern: /^\/lists\/([^/]+)$/,
    open: async (params) => {
      const { renderListDetail } = await PAGES.listDetail();
      return (host) => renderListDetail(host, param(params, 0));
    },
  },
  { id: 'calendar', pattern: /^\/agenda$/, open: async () => (await PAGES.calendar()).renderCalendar },
  { id: 'stats', pattern: /^\/stats$/, open: async () => (await PAGES.stats()).renderStats },
  { id: 'channels', pattern: /^\/telegram$/, open: async () => (await PAGES.channels()).renderTelegramChannels },
  {
    id: 'channel',
    pattern: /^\/telegram\/(.+)$/,
    open: async (params) => {
      const { renderTelegramChannel } = await PAGES.channel();
      return (host) => renderTelegramChannel(host, param(params, 0));
    },
  },
  {
    id: 'watch',
    pattern: /^\/watch\/([^/]+)\/(\d+|start)$/,
    open: async (params) => {
      const { renderWatch } = await PAGES.watch();
      return (host) => renderWatch(host, params[0] as string, params[1] as string);
    },
  },
  { id: 'connections', pattern: /^\/connections$/, open: async () => (await PAGES.connections()).renderConnections },
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
