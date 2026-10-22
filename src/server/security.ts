/**
 * O servidor só escuta em loopback, mas isso não impede um site qualquer
 * aberto no browser de falar com ele (`fetch('http://127.0.0.1:PORT/...')`
 * sai do browser normalmente). Duas barreiras, no mesmo padrão do manga-lens:
 *
 * - `Host` fora de loopback é DNS rebinding — bloqueia.
 * - método que muda estado (POST/PATCH/DELETE) com `Origin` de fora é CSRF —
 *   bloqueia; GET é seguro por ser idempotente e não é alvo de CSRF.
 */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const hostAllowed = (host: string): boolean => !host || LOOPBACK_HOST.test(host);

/**
 * Loopback não basta: qualquer outra página local (`http://localhost:3000`) também é loopback e poderia reapontar
 * a URL de uma fonte para um host dela e receber as credenciais salvas. Com `host`, só a própria origem passa.
 */
export const originAllowed = (origin: string, host = ''): boolean => {
  if (!origin) return true;
  if (!LOOPBACK_ORIGIN.test(origin)) return false;
  return !host || origin.slice('http://'.length).toLowerCase() === host.toLowerCase();
};

export const requestAllowed = (method: string, host: string, origin: string): boolean => {
  if (!hostAllowed(host)) return false;
  if (SAFE_METHODS.has(method)) return true;
  return originAllowed(origin, host);
};
