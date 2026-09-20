export interface Route {
  path: string;
  query: URLSearchParams;
}

const parse = (): Route => {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(queryString) };
};

export const navigate = (path: string): void => {
  location.hash = path;
};

export const currentRoute = (): Route => parse();

export const onRouteChange = (fn: (route: Route) => void): void => {
  const handler = () => fn(parse());
  window.addEventListener('hashchange', handler);
  handler();
};
