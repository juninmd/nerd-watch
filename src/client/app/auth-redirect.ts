/**
 * Com `ACCESS_TOKEN` ligado, uma chamada `/api` sem sessão volta 401. Em vez de cada view tratar isso, o
 * `fetch` global é envolvido uma vez: o 401 de `/api` leva para `/login`, que é uma página do servidor. Nada
 * de token no navegador: a sessão é o cookie HttpOnly.
 */
export const LOGIN_PATH = '/login';
export const LOGIN_HASH_KEY = 'nw.loginHash';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * O fragmento (#/watch/…?t=) não vai para o servidor e o login redireciona para `/`; guardar antes
 * de sair e restaurar depois do login mantém o link de retomada em outro aparelho com ACCESS_TOKEN.
 */
export const rememberLoginHash = (storage: Pick<Storage, 'setItem'>, hash: string): void => {
  try {
    if (hash.startsWith('#/')) storage.setItem(LOGIN_HASH_KEY, hash);
  } catch {
    // sem sessionStorage (modo privado): o login continua, só perde o ponto de retorno
  }
};

export const takeLoginHash = (storage: Pick<Storage, 'getItem' | 'removeItem'>): string | null => {
  try {
    const hash = storage.getItem(LOGIN_HASH_KEY);
    storage.removeItem(LOGIN_HASH_KEY);
    return hash?.startsWith('#/') ? hash : null;
  } catch {
    return null;
  }
};

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
};

export const withLoginRedirect = (fetchFn: FetchLike, base: string, goTo: (href: string) => void): FetchLike => {
  return async (input, init) => {
    const res = await fetchFn(input, init);
    if (res.status === 401 && new URL(requestUrl(input), base).pathname.startsWith('/api/')) goTo(LOGIN_PATH);
    return res;
  };
};
