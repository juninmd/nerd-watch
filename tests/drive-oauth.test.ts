import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/server/config.ts';
import {
  DriveNotConnectedError,
  DriveReauthRequiredError,
  buildAuthUrl,
  completeAuthFlow,
  createPkcePair,
  disconnectDrive,
  getAccessToken,
  getFlowState,
  resetDriveAuthForTests,
  setDriveFetchForTests,
  setTokenStoreForTests,
  startAuthFlow,
} from '../src/server/providers/drive/oauth.ts';

const original = { ...config.drive };
const saved: string[] = [];
let cleared = 0;

const form = (init?: RequestInit): URLSearchParams => new URLSearchParams(String(init?.body));
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetDriveAuthForTests();
  saved.length = 0;
  cleared = 0;
  Object.assign(config.drive, { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-test-secret', refreshToken: undefined });
  setTokenStoreForTests({
    save: (t) => {
      saved.push(t);
      config.drive.refreshToken = t;
    },
    clear: () => {
      cleared++;
      config.drive.refreshToken = undefined;
    },
  });
});

afterEach(() => {
  setDriveFetchForTests();
  setTokenStoreForTests();
  Object.assign(config.drive, original);
});

describe('PKCE e URL de autorização', () => {
  test('o challenge é o SHA-256 base64url do verifier', () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  test('pede só leitura, refresh token e PKCE S256 — e nunca leva o client secret', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:7799/api/drive/oauth/callback', state: 's1', challenge: 'ch' }));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.href).not.toContain('GOCSPX');
  });
});

describe('fluxo de autorização', () => {
  test('sem client ID/secret não inicia', () => {
    Object.assign(config.drive, { clientId: undefined, clientSecret: undefined });
    expect(startAuthFlow('http://127.0.0.1:7799/cb').ok).toBe(false);
  });

  test('troca o código (com o verifier do PKCE) e guarda só o refresh token', async () => {
    const sentBodies: URLSearchParams[] = [];
    setDriveFetchForTests(async (_url, init) => {
      sentBodies.push(form(init));
      return json({ access_token: 'acc', refresh_token: 'ref-1', expires_in: 3600 });
    });
    const start = startAuthFlow('http://127.0.0.1:7799/cb');
    if (!start.ok) throw new Error('deveria iniciar');
    const state = new URL(start.authUrl).searchParams.get('state');
    const challenge = new URL(start.authUrl).searchParams.get('code_challenge');

    const result = await completeAuthFlow({ state, code: 'abc', error: null });
    expect(result.status).toBe('connected');
    expect(saved).toEqual(['ref-1']);
    const sent = sentBodies[0];
    expect(sent?.get('grant_type')).toBe('authorization_code');
    expect(sent?.get('code')).toBe('abc');
    expect(createHash('sha256').update(sent?.get('code_verifier') ?? '').digest('base64url')).toBe(challenge ?? '');
  });

  test('state desconhecido ou repetido descarta o código sem chamar o Google', async () => {
    let calls = 0;
    setDriveFetchForTests(async () => {
      calls++;
      return json({ access_token: 'a', refresh_token: 'r' });
    });
    const start = startAuthFlow('http://127.0.0.1:7799/cb');
    if (!start.ok) throw new Error('deveria iniciar');
    const state = new URL(start.authUrl).searchParams.get('state');

    expect((await completeAuthFlow({ state: 'forjado', code: 'x', error: null })).status).toBe('error');
    expect(calls).toBe(0);
    expect((await completeAuthFlow({ state, code: 'x', error: null })).status).toBe('connected');
    expect((await completeAuthFlow({ state, code: 'x', error: null })).status).toBe('error');
    expect(calls).toBe(1);
  });

  test('pedido expirado (mais de 10 min) é recusado', async () => {
    const start = startAuthFlow('http://127.0.0.1:7799/cb', 1_000);
    if (!start.ok) throw new Error('deveria iniciar');
    const state = new URL(start.authUrl).searchParams.get('state');
    expect((await completeAuthFlow({ state, code: 'x', error: null }, 1_000 + 11 * 60_000)).status).toBe('error');
  });

  test('acesso negado e ausência de refresh token viram erro legível', async () => {
    const first = startAuthFlow('http://127.0.0.1:7799/cb');
    if (!first.ok) throw new Error('deveria iniciar');
    const denied = await completeAuthFlow({ state: new URL(first.authUrl).searchParams.get('state'), code: null, error: 'access_denied' });
    expect(denied).toEqual({ status: 'error', error: 'acesso negado no Google' });

    setDriveFetchForTests(async () => json({ access_token: 'a' }));
    const second = startAuthFlow('http://127.0.0.1:7799/cb');
    if (!second.ok) throw new Error('deveria iniciar');
    const noRefresh = await completeAuthFlow({ state: new URL(second.authUrl).searchParams.get('state'), code: 'x', error: null });
    expect(noRefresh.status).toBe('error');
    expect(saved).toEqual([]);
    expect(getFlowState().status).toBe('error');
  });
});

describe('access token', () => {
  test('sem refresh token pede para conectar', async () => {
    await expect(getAccessToken()).rejects.toBeInstanceOf(DriveNotConnectedError);
  });

  test('renova com o refresh token, guarda em cache e renova de novo perto do vencimento', async () => {
    config.drive.refreshToken = 'ref';
    let calls = 0;
    setDriveFetchForTests(async (_url, init) => {
      calls++;
      expect(form(init).get('grant_type')).toBe('refresh_token');
      return json({ access_token: `acc-${calls}`, expires_in: 3600 });
    });
    expect(await getAccessToken(0)).toBe('acc-1');
    expect(await getAccessToken(1_000)).toBe('acc-1');
    expect(calls).toBe(1);
    expect(await getAccessToken(3_600_000 - 30_000)).toBe('acc-2');
  });

  test('várias chamadas simultâneas disparam uma única renovação', async () => {
    config.drive.refreshToken = 'ref';
    let calls = 0;
    setDriveFetchForTests(async () => {
      calls++;
      await Promise.resolve();
      return json({ access_token: 'acc', expires_in: 3600 });
    });
    await Promise.all([getAccessToken(0), getAccessToken(0), getAccessToken(0)]);
    expect(calls).toBe(1);
  });

  test('invalid_grant (revogado ou expirado) exige reconectar', async () => {
    config.drive.refreshToken = 'ref';
    setDriveFetchForTests(async () => json({ error: 'invalid_grant' }, 400));
    await expect(getAccessToken(0)).rejects.toBeInstanceOf(DriveReauthRequiredError);
  });
});

describe('desconectar', () => {
  test('esquece o token local e revoga no Google', async () => {
    config.drive.refreshToken = 'ref-xyz';
    const revoked: Array<string | null> = [];
    setDriveFetchForTests(async (_url, init) => {
      revoked.push(form(init).get('token'));
      return json({});
    });
    await disconnectDrive();
    expect(cleared).toBe(1);
    expect(config.drive.refreshToken).toBeUndefined();
    expect(revoked).toEqual(['ref-xyz']);
  });

  test('falha ao revogar não impede de desconectar', async () => {
    config.drive.refreshToken = 'ref';
    setDriveFetchForTests(async () => {
      throw new Error('offline');
    });
    await expect(disconnectDrive()).resolves.toBeUndefined();
    expect(cleared).toBe(1);
  });
});
