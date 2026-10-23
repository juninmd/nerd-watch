/**
 * Com `ACCESS_TOKEN` ligado, uma chamada `/api` sem sessão volta 401. Em vez de cada view tratar isso, o
 * `fetch` global é envolvido uma vez: o 401 de `/api` leva para `/login`, que é uma página do servidor. Nada
 * de token no navegador: a sessão é o cookie HttpOnly.
 */
export const LOGIN_PATH = '/login';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
