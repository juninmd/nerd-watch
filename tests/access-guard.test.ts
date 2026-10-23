import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { createAccess, SESSION_COOKIE } from '../src/server/access-guard.ts';
import { serveFile } from '../src/server/providers/local/range.ts';
import { requestAllowed } from '../src/server/security.ts';

// Token falso: só existe neste arquivo de teste.
const TOKEN = 'fake-token-0123456789';
const HOST = 'nerd.test';
const SAFE_ORIGIN = `http://${HOST}`;

const tmp = mkdtempSync(path.join(tmpdir(), 'nerd-access-'));
const publicDir = path.join(tmp, 'public');
const mediaFile = path.join(tmp, 'clip.mp4');
mkdirSync(publicDir);
writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>app</title>');
writeFileSync(path.join(tmp, 'secret.txt'), 'SEGREDO-FORA-DO-PUBLIC');
writeFileSync(mediaFile, 'abcdefghijklmnopqrstuvwxyz');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Monta o mesmo empilhamento do `index.ts`: Host/Origin, depois o guard, depois rotas e estáticos. */
const buildApp = (opts: { now?: () => number; trustProxy?: boolean; token?: string } = {}) => {
  const access = createAccess({ token: opts.token ?? TOKEN, trustProxy: opts.trustProxy ?? false, now: opts.now });
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (!requestAllowed(c.req.method, c.req.header('Host') ?? '', c.req.header('Origin') ?? '', true)) {
      return c.text('requisição não permitida', 403);
    }
    await next();
  });
  app.use('*', access.guard);
  app.route('/', access.routes);
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/search', (c) => c.json({ results: [] }));
  app.get('/api/media', (c) => serveFile(mediaFile, c.req.header('Range')));
  app.use('/*', serveStatic({ root: publicDir }));
  return app;
};

const get = (app: Hono, target: string, headers: Record<string, string> = {}) =>
  app.request(`http://${HOST}${target}`, { headers: { Host: HOST, ...headers } });

const loginForm = (token: string, headers: Record<string, string> = {}, base = `http://${HOST}`) =>
  new Request(`${base}/login`, {
    method: 'POST',
    headers: { Host: HOST, Origin: SAFE_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ token }).toString(),
  });

const sessionCookieFrom = (res: Response): string => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!line) throw new Error('sem cookie de sessão');
  return line;
};

describe('sem credencial', () => {
  test('rota /api protegida responde 401 com WWW-Authenticate e sem vazar a lista de rotas', async () => {
    const app = buildApp();
    const res = await get(app, '/api/search?q=x');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(await res.text()).not.toContain('results');
  });

  test('/api/health, o login e o front continuam públicos', async () => {
    const app = buildApp();
    expect((await get(app, '/api/health')).status).toBe(200);
    expect((await get(app, '/login')).status).toBe(200);
    expect((await get(app, '/')).status).toBe(200);
  });

  test('variações de caminho para /api não furam o guard', async () => {
    const app = buildApp();
    for (const target of ['/API/search', '/api/search/', '/%61pi/search', '/api/search%3F']) {
      const res = await get(app, target);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('"results"');
    }
  });

  test('traversal no estático não lê arquivo fora de public/', async () => {
    const app = buildApp();
    for (const target of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt']) {
      const res = await get(app, target);
      expect(await res.text()).not.toContain('SEGREDO-FORA-DO-PUBLIC');
    }
  });
});

describe('Bearer para scripts', () => {
  test('token correto passa; esquema em qualquer caixa', async () => {
    const app = buildApp();
    expect((await get(app, '/api/search', { Authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await get(app, '/api/search', { Authorization: `bearer ${TOKEN}` })).status).toBe(200);
  });

  test('cabeçalho com muitos espaços não trava o servidor (sem regex com backtracking)', async () => {
    const app = buildApp();
    const started = Date.now();
    const res = await get(app, '/api/search', { Authorization: `Bearer a${' '.repeat(16000)}b` });
    expect(res.status).toBe(401);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('token longo (até 1024 caracteres) também entra pelo formulário', async () => {
    const long = `fake-long-${'x'.repeat(1000)}`;
    const app = buildApp({ token: long });
    expect((await app.request(loginForm(long))).status).toBe(303);
  });

  test('token errado ou sem esquema Bearer recebe 401', async () => {
    const app = buildApp();
    expect((await get(app, '/api/search', { Authorization: 'Bearer fake-token-wrong-0000' })).status).toBe(401);
    expect((await get(app, '/api/search', { Authorization: TOKEN })).status).toBe(401);
  });
});

describe('login por formulário', () => {
  test('página de login é HTML com formulário POST e nunca reflete o token', async () => {
    const app = buildApp();
    const res = await get(app, '/login');
    const html = await res.text();
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="token"');
    expect(html).not.toContain(TOKEN);
  });

  test('token correto: 303 para / com cookie HttpOnly, SameSite=Strict, Path=/ e valor derivado', async () => {
    const app = buildApp();
    const res = await app.request(loginForm(TOKEN));
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
    const cookie = sessionCookieFrom(res);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    // HMAC-SHA256 em base64url: 43 caracteres, nunca o token em claro.
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie).not.toContain(TOKEN);
  });

  test('token no formato de `openssl rand -base64` (com + / =) entra pelo formulário', async () => {
    const b64 = 'fake+tok/en=0123456789+abc'; // falso; só o formato importa
    const app = buildApp({ token: b64 });
    expect((await app.request(loginForm(b64))).status).toBe(303);
    expect((await app.request(loginForm('fake tok'))).status).toBe(401);
  });

  test('em http o cookie não leva Secure; em https leva', async () => {
    const app = buildApp();
    expect(sessionCookieFrom(await app.request(loginForm(TOKEN)))).not.toContain('Secure');
    const secure = await app.request(loginForm(TOKEN, {}, `https://${HOST}`));
    expect(sessionCookieFrom(secure)).toContain('Secure');
  });

  test('X-Forwarded-Proto=https só marca Secure com ACCESS_TRUST_PROXY ligado', async () => {
    const untrusted = buildApp({ trustProxy: false });
    expect(sessionCookieFrom(await untrusted.request(loginForm(TOKEN, { 'X-Forwarded-Proto': 'https' })))).not.toContain(
      'Secure',
    );
    const trusted = buildApp({ trustProxy: true });
    expect(sessionCookieFrom(await trusted.request(loginForm(TOKEN, { 'X-Forwarded-Proto': 'https' })))).toContain(
      'Secure',
    );
  });

  test('token errado: 401 com a página de login, sem cookie e sem eco do valor', async () => {
    const app = buildApp();
    const res = await app.request(loginForm('fake-token-wrong-0000'));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(await res.text()).not.toContain('fake-token-wrong-0000');
  });

  test('corpo grande no login é recusado com 413, mesmo sem Content-Length (chunked)', async () => {
    const app = buildApp();
    const huge = `token=${'a'.repeat(100_000)}`;
    const chunked = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(huge));
        controller.close();
      },
    });
    const res = await app.request(
      new Request(`http://${HOST}/login`, {
        method: 'POST',
        headers: { Host: HOST, Origin: SAFE_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: chunked,
        duplex: 'half',
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  test('POST /login de outra origem é barrado pelo CSRF (Origin != Host)', async () => {
    const app = buildApp();
    const res = await app.request(loginForm(TOKEN, { Origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});

describe('rate limit de tentativas falhas', () => {
  test('10 falhas travam a janela: até o token correto recebe 429', async () => {
    const app = buildApp({ now: () => 1_000 });
    for (let i = 0; i < 10; i++) {
      expect((await app.request(loginForm('fake-token-wrong-0000'))).status).toBe(401);
    }
    expect((await app.request(loginForm('fake-token-wrong-0000'))).status).toBe(429);
    expect((await app.request(loginForm(TOKEN))).status).toBe(429);
    expect((await get(app, '/api/search', { Authorization: `Bearer ${TOKEN}` })).status).toBe(429);
  });

  test('a janela desliza: passado o intervalo, o login volta a funcionar', async () => {
    let t = 1_000;
    const app = buildApp({ now: () => t });
    for (let i = 0; i < 10; i++) await app.request(loginForm('fake-token-wrong-0000'));
    expect((await app.request(loginForm(TOKEN))).status).toBe(429);
    t += 15 * 60_000 + 1;
    expect((await app.request(loginForm(TOKEN))).status).toBe(303);
  });

  test('sessão já válida continua funcionando durante o bloqueio', async () => {
    const t = 1_000;
    const app = buildApp({ now: () => t });
    const cookie = sessionCookieFrom(await app.request(loginForm(TOKEN)));
    for (let i = 0; i < 10; i++) await app.request(loginForm('fake-token-wrong-0000'));
    expect((await get(app, '/api/search', { Cookie: cookie.split(';')[0] ?? '' })).status).toBe(200);
  });
});

describe('cookie de sessão', () => {
  test('cookie válido autentica a API (e é o que o <video> manda)', async () => {
    const app = buildApp();
    const cookie = sessionCookieFrom(await app.request(loginForm(TOKEN))).split(';')[0] ?? '';
    expect((await get(app, '/api/search', { Cookie: cookie })).status).toBe(200);
  });

  test('cookie falso não autentica', async () => {
    const app = buildApp();
    expect((await get(app, '/api/search', { Cookie: `${SESSION_COOKIE}=nao-e-o-valor` })).status).toBe(401);
  });

  test('Range com cookie: o <video> recebe 206 com o trecho pedido', async () => {
    const app = buildApp();
    const cookie = sessionCookieFrom(await app.request(loginForm(TOKEN))).split(';')[0] ?? '';
    const res = await get(app, '/api/media', { Cookie: cookie, Range: 'bytes=0-3' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-3/26');
    expect(await res.text()).toBe('abcd');
  });

  test('Range sem cookie continua barrado', async () => {
    const app = buildApp();
    expect((await get(app, '/api/media', { Range: 'bytes=0-3' })).status).toBe(401);
  });
});

describe('logout', () => {
  const logout = (app: Hono, cookie?: string) =>
    app.request(
      new Request(`http://${HOST}/logout`, {
        method: 'POST',
        headers: { Host: HOST, Origin: SAFE_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      }),
    );

  test('POST /logout limpa o cookie no navegador (mesmos atributos, Max-Age=0)', async () => {
    const app = buildApp();
    const res = await logout(app);
    expect(res.status).toBe(303);
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Strict');
  });

  test('a sessão antiga deixa de valer no servidor (cookie copiado não sobrevive ao logout)', async () => {
    const app = buildApp();
    const cookie = sessionCookieFrom(await app.request(loginForm(TOKEN))).split(';')[0] ?? '';
    expect((await get(app, '/api/search', { Cookie: cookie })).status).toBe(200);
    await logout(app, cookie);
    expect((await get(app, '/api/search', { Cookie: cookie })).status).toBe(401);
  });

  test('logout sem sessão não derruba a sessão do dono (ninguém desloga em loop sem o token)', async () => {
    const app = buildApp();
    const cookie = sessionCookieFrom(await app.request(loginForm(TOKEN))).split(';')[0] ?? '';
    expect((await logout(app)).status).toBe(303);
    expect((await get(app, '/api/search', { Cookie: cookie })).status).toBe(200);
  });

  test('reiniciar o processo invalida sessões antigas (geração nova por boot)', async () => {
    const before = buildApp();
    const cookie = sessionCookieFrom(await before.request(loginForm(TOKEN))).split(';')[0] ?? '';
    const after = buildApp();
    expect((await get(after, '/api/search', { Cookie: cookie })).status).toBe(401);
  });

  test('logout por GET não existe (evita logout por <img src>)', async () => {
    const app = buildApp();
    expect((await get(app, '/logout')).status).not.toBe(303);
  });
});
