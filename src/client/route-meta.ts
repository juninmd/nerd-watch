/** Rótulo pt-BR de cada rota: alimenta o `<title>` da aba e o anúncio do leitor de tela. Sem DOM, para ser testável. */
const EXACT_LABELS: Record<string, string> = {
  '/': 'Início',
  '/library': 'Biblioteca',
  '/my-list': 'Biblioteca',
  '/agenda': 'Agenda',
  '/calendar': 'Agenda',
  '/telegram': 'Canais',
  '/connections': 'Conexões',
  '/public-domain': 'Domínio público',
  '/search': 'Busca',
};

const MAX_QUERY_IN_TITLE = 60;

export const routeLabel = (path: string, query: URLSearchParams): string => {
  if (path === '/search') {
    const q = query.get('q')?.trim().slice(0, MAX_QUERY_IN_TITLE);
    return q ? `Busca: ${q}` : 'Busca';
  }
  if (Object.hasOwn(EXACT_LABELS, path)) return EXACT_LABELS[path] as string;
  if (path.startsWith('/telegram/')) return 'Canal do Telegram';
  if (path.startsWith('/watch/')) return 'Assistir';
  if (path.startsWith('/title/')) return 'Título';
  return 'Página não encontrada';
};

export const routeTitle = (path: string, query: URLSearchParams): string => `${routeLabel(path, query)} · nerd-watch`;
