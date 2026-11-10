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

/**
 * Com `ACCESS_TOKEN` o app pode ser alcançado por outro nome ou IP, então o `Host` não tem como ser só loopback.
 * A barreira passa a ser o token (rebinding não carrega o cookie nem o Bearer), e o CSRF segue barrado pela
 * igualdade Origin == Host. Sem Host não há como provar a origem, então escrita com Origin também é recusada.
 */
const sameOriginAs = (origin: string, host: string): boolean =>
  host !== '' && /^https?:\/\//i.test(origin) && origin.replace(/^https?:\/\//i, '').toLowerCase() === host.toLowerCase();

export const requestAllowed = (method: string, host: string, origin: string, remote = false): boolean => {
  if (remote) return SAFE_METHODS.has(method) || !origin || sameOriginAs(origin, host);
  if (!hostAllowed(host)) return false;
  if (SAFE_METHODS.has(method)) return true;
  return originAllowed(origin, host);
};
