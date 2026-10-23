import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isPublicPath, isSecureRequest, newGeneration, safeEqual, sessionValue } from './access.ts';
import { loginPage } from './access-page.ts';
import { createRateLimiter } from './rate-limit.ts';

export const SESSION_COOKIE = 'nerd_watch_session';

/** Falhas (formulário ou Bearer) por janela. A janela é global ao processo: memória limitada a `MAX` timestamps. */
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FORM_BYTES = 16384;
const MAX_TOKEN_CHARS = 4096;

/** Sem regex: `^Bearer\s+(.+?)\s*$` backtrackea de forma quadrática num cabeçalho com muitos espaços, antes de qualquer auth. */
const bearerToken = (auth: string | undefined): string | undefined => {
  if (auth === undefined) return undefined;
  const value = auth.trim();
  if (value.slice(0, 7).toLowerCase() !== 'bearer ') return undefined;
  const token = value.slice(7).trim();
  return token === '' ? undefined : token;
};
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";

export interface AccessOptions {
  token: string;
  /** Lê `X-Forwarded-Proto` para decidir o `Secure` do cookie. Só ligue atrás de um proxy que você controla. */
  trustProxy: boolean;
  now?: () => number;
}

export interface Access {
  /** Protege tudo que não é público. Deve ser montado depois da checagem de Host/Origin. */
  guard: MiddlewareHandler;
  /** `GET/POST /login` e `POST /logout`. */
  routes: Hono;
}

/** Lê o corpo até `max` bytes e cancela ao passar: rota pública não pode guardar corpo sem limite (chunked). */
const readCapped = async (req: Request, max: number): Promise<string | undefined> => {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

const pageResponse = (c: Context, message: string | undefined, status: 200 | 401 | 413 | 429) => {
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', PAGE_CSP);
  return c.html(loginPage(message), status);
};

/**
 * Estado em memória de uma instância: a geração (troca no logout e a cada boot) e o limitador de falhas.
 * Nada disso vai para disco nem para log.
 */
export const createAccess = (opts: AccessOptions): Access => {
  const { token, trustProxy } = opts;
  const failures = createRateLimiter('login', LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, opts.now);
  let generation = newGeneration();

  const hasValidSession = (c: Context): boolean => {
    const value = getCookie(c, SESSION_COOKIE);
    return value !== undefined && safeEqual(value, sessionValue(token, generation));
  };

  const cookieFlags = (c: Context) => ({
    httpOnly: true,
    sameSite: 'Strict' as const,
    path: '/',
    secure: isSecureRequest(c.req.url, c.req.header('X-Forwarded-Proto'), trustProxy),
  });

  const guard: MiddlewareHandler = async (c, next) => {
    const rawPath = new URL(c.req.url).pathname;
    if (isPublicPath(c.req.method, rawPath, c.req.path)) return next();

    const presented = bearerToken(c.req.header('Authorization'));
    // Bloqueado: nenhuma credencial nova é aceita, mas a sessão já aberta no navegador segue valendo.
    if (presented !== undefined && failures.isFull()) {
      c.header('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
      return c.json({ error: 'muitas tentativas, aguarde alguns minutos' }, 429);
    }
    if (presented !== undefined && safeEqual(presented, token)) return next();
    if (hasValidSession(c)) return next();
    // Só erro de Bearer conta: uma requisição sem credenciais não é tentativa de adivinhar nada.
    if (presented !== undefined) failures.acquire();
    return c.json({ error: 'acesso negado: informe o token de acesso' }, 401, {
      'WWW-Authenticate': 'Bearer realm="nerd-watch"',
    });
  };

  const routes = new Hono();

  routes.get('/login', (c) => pageResponse(c, undefined, 200));

  routes.post('/login', async (c) => {
    // Corpo antes da checagem de limite: o `await` poderia deixar a janela cheia entre o teste e a contagem.
    const body = await readCapped(c.req.raw, MAX_FORM_BYTES);
    if (body === undefined) return pageResponse(c, undefined, 413);
    const field = new URLSearchParams(body).get('token') ?? '';
    const candidate = field.length <= MAX_TOKEN_CHARS ? field : '';

    if (failures.isFull()) return pageResponse(c, 'Muitas tentativas. Aguarde alguns minutos.', 429);
    if (candidate !== '' && safeEqual(candidate, token)) {
      setCookie(c, SESSION_COOKIE, sessionValue(token, generation), cookieFlags(c));
      return c.redirect('/', 303);
    }
    failures.acquire();
    return pageResponse(c, 'Token inválido.', 401);
  });

  routes.post('/logout', (c) => {
    // Só quem já tem sessão derruba as outras: senão qualquer um sem token poderia deslogar o dono em loop.
    if (hasValidSession(c)) generation = newGeneration();
    deleteCookie(c, SESSION_COOKIE, cookieFlags(c));
    return c.redirect('/login', 303);
  });

  return { guard, routes };
};
