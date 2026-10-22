import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createOAuthClient, OAuthNotConnectedError, OAuthReauthRequiredError, type OAuthSpec } from '../src/server/providers/oauth/client.ts';

const spec: OAuthSpec = {
  name: 'Servico X',
  clientIdEnv: 'TEST_OAUTH_CLIENT_ID',
  clientSecretEnv: 'TEST_OAUTH_CLIENT_SECRET',
  refreshTokenEnv: 'TEST_OAUTH_REFRESH',
  endpoints: () => ({ authUrl: 'https://auth.example/authorize', tokenUrl: 'https://auth.example/token' }),
  scope: 'files.read',
  authParams: { prompt: 'consent' },
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const ENVS = [spec.clientIdEnv, spec.clientSecretEnv ?? '', spec.refreshTokenEnv];
const client = createOAuthClient(spec);

let calls: Array<{ url: string; body: URLSearchParams; headers: Headers }> = [];
const fake = (handler: (body: URLSearchParams, url: string) => Response) =>
  client.setFetchForTests(async (url, init) => {
    const body = new URLSearchParams(String(init?.body ?? ''));
    calls.push({ url: String(url), body, headers: new Headers(init?.headers) });
    return handler(body, String(url));
  });

beforeEach(() => {
  calls = [];
  client.resetForTests();
  process.env.TEST_OAUTH_CLIENT_ID = 'cid';
  process.env.TEST_OAUTH_CLIENT_SECRET = 'csecret';
  delete process.env.TEST_OAUTH_REFRESH;
});

afterEach(() => {
  client.setFetchForTests();
  for (const env of ENVS) delete process.env[env];
});

const authorize = async (): Promise<string> => {
  const started = client.start('http://127.0.0.1:7799/cb', 1_000);
  if (!started.ok) throw new Error(started.error);
  return new URL(started.authUrl).searchParams.get('state') as string;
};

describe('start', () => {
  test('monta a URL com PKCE S256, state e os parâmetros do serviço', () => {
    const started = client.start('http://127.0.0.1:7799/cb');
    expect(started.ok).toBe(true);
    const url = new URL((started as { authUrl: string }).authUrl);
    expect(url.origin + url.pathname).toBe('https://auth.example/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:7799/cb',
      response_type: 'code',
      scope: 'files.read',
      code_challenge_method: 'S256',
      prompt: 'consent',
    });
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  test('sem credenciais não inicia o fluxo', () => {
    delete process.env.TEST_OAUTH_CLIENT_SECRET;
    expect(client.start('http://127.0.0.1:7799/cb')).toEqual({ ok: false, error: 'informe as credenciais de Servico X antes de conectar' });
  });
});

describe('complete', () => {
  test('troca o código (com o verifier do PKCE) e guarda o refresh token', async () => {
    const state = await authorize();
    fake(() => json({ access_token: 'acc', refresh_token: 'ref-1', expires_in: 3600 }));
    expect(await client.complete({ state, code: 'abc', error: null }, 2_000)).toEqual({ status: 'connected' });
    expect(calls[0]?.body.get('grant_type')).toBe('authorization_code');
    expect(calls[0]?.body.get('code')).toBe('abc');
    expect(calls[0]?.body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(process.env.TEST_OAUTH_REFRESH).toBe('ref-1');
    expect(client.connected()).toBe(true);
  });

  test('state desconhecido, repetido ou expirado descarta o código sem falar com o serviço', async () => {
    fake(() => json({ access_token: 'acc', refresh_token: 'r' }));
    expect((await client.complete({ state: 'forjado', code: 'abc', error: null })).status).toBe('error');
    const state = await authorize();
    expect((await client.complete({ state, code: 'abc', error: null }, 1_000 + 11 * 60_000)).status).toBe('error');
    expect((await client.complete({ state, code: 'abc', error: null }, 2_000)).status).toBe('error');
    expect(calls).toHaveLength(0);
    expect(client.connected()).toBe(false);
  });

  test('sem refresh token na resposta falha com instrução, sem marcar como conectado', async () => {
    const state = await authorize();
    fake(() => json({ access_token: 'acc' }));
    const result = await client.complete({ state, code: 'abc', error: null }, 2_000);
    expect(result.status).toBe('error');
    expect(client.connected()).toBe(false);
  });

  test('usuário negou o acesso', async () => {
    const state = await authorize();
    expect(await client.complete({ state, code: null, error: 'access_denied' }, 2_000)).toEqual({ status: 'error', error: 'acesso negado em Servico X' });
  });
});

describe('accessToken', () => {
  beforeEach(() => {
    process.env.TEST_OAUTH_REFRESH = 'ref-0';
  });

  test('renova uma vez só mesmo com várias chamadas simultâneas e reaproveita o token em cache', async () => {
    fake(() => json({ access_token: 'acc-1', expires_in: 3600 }));
    const tokens = await Promise.all([client.accessToken(0), client.accessToken(0), client.accessToken(0)]);
    expect(tokens).toEqual(['acc-1', 'acc-1', 'acc-1']);
    await client.accessToken(1_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.get('refresh_token')).toBe('ref-0');
    expect(calls[0]?.body.get('client_secret')).toBe('csecret');
  });

  test('renova de novo perto do vencimento', async () => {
    fake(() => json({ access_token: 'acc', expires_in: 100 }));
    await client.accessToken(0);
    await client.accessToken(50_000);
    expect(calls).toHaveLength(2);
  });

  test('guarda o refresh token novo quando o serviço gira o token a cada renovação', async () => {
    fake(() => json({ access_token: 'acc', refresh_token: 'ref-NOVO', expires_in: 3600 }));
    await client.accessToken(0);
    expect(process.env.TEST_OAUTH_REFRESH).toBe('ref-NOVO');
  });

  test('invalid_grant vira "reconectar" (409) e sem refresh token vira "não conectado" (501)', async () => {
    fake(() => json({ error: 'invalid_grant' }, 400));
    const err = await client.accessToken(0).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthReauthRequiredError);
    expect(err.status).toBe(409);

    delete process.env.TEST_OAUTH_REFRESH;
    const none = await client.accessToken(0).catch((e) => e);
    expect(none).toBeInstanceOf(OAuthNotConnectedError);
    expect(none.status).toBe(501);
  });

  test('cliente público (sem secret) não manda client_secret', async () => {
    const pub = createOAuthClient({ ...spec, clientSecretEnv: undefined });
    let sent: URLSearchParams | null = null;
    pub.setFetchForTests(async (_u, init) => {
      sent = new URLSearchParams(String(init?.body));
      return json({ access_token: 'a', expires_in: 3600 });
    });
    await pub.accessToken(0);
    expect((sent as URLSearchParams | null)?.has('client_secret')).toBe(false);
  });
});

describe('authedFetch', () => {
  beforeEach(() => {
    process.env.TEST_OAUTH_REFRESH = 'ref-0';
  });

  test('manda o Bearer e, ao tomar 401, renova uma vez e repete', async () => {
    let tokens = 0;
    const seen: string[] = [];
    client.setFetchForTests(async (url, init) => {
      if (String(url).endsWith('/token')) return json({ access_token: `acc-${++tokens}`, expires_in: 3600 });
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      seen.push(auth);
      return auth === 'Bearer acc-1' ? new Response('', { status: 401 }) : new Response('ok');
    });
    const res = await client.authedFetch('https://api.example/x');
    expect(await res.text()).toBe('ok');
    expect(seen).toEqual(['Bearer acc-1', 'Bearer acc-2']);
  });

  test('401 persistente vira "reconectar"', async () => {
    client.setFetchForTests(async (url) => (String(url).endsWith('/token') ? json({ access_token: 'a', expires_in: 3600 }) : new Response('', { status: 401 })));
    await expect(client.authedFetch('https://api.example/x')).rejects.toBeInstanceOf(OAuthReauthRequiredError);
  });
});

describe('disconnect', () => {
  test('esquece o token, revoga no serviço quando há como e tolera falha na revogação', async () => {
    process.env.TEST_OAUTH_REFRESH = 'ref-0';
    const revoked: string[] = [];
    const withRevoke = createOAuthClient({
      ...spec,
      revoke: async (token) => {
        revoked.push(token);
        throw new Error('rede caiu');
      },
    });
    await withRevoke.disconnect();
    expect(revoked).toEqual(['ref-0']);
    expect(process.env.TEST_OAUTH_REFRESH).toBeUndefined();
    expect(withRevoke.connected()).toBe(false);
  });
});
