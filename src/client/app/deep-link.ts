/**
 * Links internos do app (`#/rota?t=segundos`). A posição vai na query para que o link abra o vídeo
 * já no ponto em que a pessoa parou, inclusive em outro navegador/aparelho que ainda não baixou o
 * progresso do servidor. Tudo aqui é função pura (sem DOM) para testar.
 */

/** Um dia cobre qualquer vídeo de canal; acima disso é link inválido, não um ponto de retomada. */
export const MAX_START_SECONDS = 86_400;

/** `t` da URL: inteiro de 0 a 24 h; qualquer outra coisa vira "sem posição". */
export const parseStartTime = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  // Aceita só segundos inteiros em decimal: `12.5`, `1e3` e ` 12` não são pontos de retomada.
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_START_SECONDS) return null;
  return seconds;
};

/** Acrescenta `t=` preservando a query existente; sem posição válida devolve o caminho como veio. */
export const withStartTime = (path: string, at?: number | null): string => {
  const seconds = parseStartTime(at);
  if (seconds === null) return path;
  const cut = path.indexOf('?');
  const base = cut === -1 ? path : path.slice(0, cut);
  const params = new URLSearchParams(cut === -1 ? '' : path.slice(cut + 1));
  params.set('t', String(seconds));
  return `${base}?${params.toString()}`;
};

/**
 * Segundo que o link deve carregar: o maior entre o tempo atual e a posição salva (o link nunca
 * volta); sem nenhum dos dois, o `t` que já veio no link.
 */
export const startSecond = (live: number | null, saved: number | null, requested: number | null = null): number | null => {
  const at = typeof live === 'number' && Number.isFinite(live) ? Math.floor(live) : 0;
  const savedAt = typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 ? saved : null;
  // Mesma regra do player: o link só avança; se a posição salva já está à frente, o link vale por ela.
  if (at > 0) return savedAt !== null && savedAt > at ? savedAt : at;
  return savedAt ?? requested;
};

/** Rota da tela + query, do jeito que vai depois do `#`. */
export const routeWithQuery = (route: { path: string; query: URLSearchParams }): string => {
  const query = route.query.toString();
  return query ? `${route.path}?${query}` : route.path;
};

/**
 * URL para abrir o app. Em http(s) usa a origem e o caminho atuais (funciona em outra aba ou
 * aparelho que alcance o servidor); com `base=''` (desktop, sem página servida) devolve só o hash.
 */
export const inAppUrl = (path: string, at?: number | null, base?: string): string => {
  const route = withStartTime(path.startsWith('/') ? path : `/${path}`, at);
  const origin =
    base ??
    (typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')
      ? `${location.origin}${location.pathname}`
      : '');
  return `${origin}#${route}`;
};
