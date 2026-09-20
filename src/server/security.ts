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
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const hostAllowed = (host: string): boolean => !host || LOOPBACK_HOST.test(host);

export const originAllowed = (origin: string): boolean => !origin || LOOPBACK_ORIGIN.test(origin);

export const requestAllowed = (method: string, host: string, origin: string): boolean => {
  if (!hostAllowed(host)) return false;
  if (SAFE_METHODS.has(method)) return true;
  return originAllowed(origin);
};
