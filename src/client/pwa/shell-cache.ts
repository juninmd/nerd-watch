/**
 * Lógica pura do service worker, separada do `sw.ts` para ser testável sem browser. Só a casca estática
 * (html, js, css, ícones) entra no cache; `/api/*`, mídia e requisições com Range sempre vão para a rede.
 */

/** Bump quando o formato do cache mudar. Versões antigas do mesmo prefixo são apagadas no `activate`. */
export const SHELL_CACHE_VERSION = 'v1';
export const SHELL_CACHE_PREFIX = 'nerd-watch-shell-';
export const SHELL_CACHE_NAME = `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}`;

export interface ShellRequest {
  method: string;
  url: string;
  hasRange: boolean;
}

const SHELL_FILE = /\.(html|js|css|webmanifest|svg|png|ico)$/i;

export const isShellRequest = (request: ShellRequest, appOrigin: string): boolean => {
  if (request.method !== 'GET' || request.hasRange) return false;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== appOrigin) return false;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return false;

  return url.pathname === '/' || SHELL_FILE.test(url.pathname);
};

/** Só apaga caches com o nosso prefixo: a origem pode ter outros caches que não são deste app. */
export const isStaleShellCache = (cacheName: string, currentName: string = SHELL_CACHE_NAME): boolean =>
  cacheName.startsWith(SHELL_CACHE_PREFIX) && cacheName !== currentName;
