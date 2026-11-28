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

/**
 * Página de reserva quando nem a rede nem o cache têm a casca (primeira visita offline): melhor que a tela de erro do navegador.
 * HTML estático, sem script, com o mesmo fundo escuro do app.
 */
export const OFFLINE_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nerd-watch · sem internet</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1116;color:#e8eaed;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:16px}a{color:#8ab4f8}</style></head><body><main><h1>Você está sem internet</h1><p>O nerd-watch abre assim que a conexão voltar.</p><p><a href="">Tentar de novo</a></p></main></body></html>`;
