import { createHash, randomBytes } from 'node:crypto';
import { SourceError } from '../sources/types.ts';
import { readSetting, writeSetting } from '../sources/settings.ts';

const FLOW_TTL_MS = 10 * 60_000;
/** Renova um pouco antes do vencimento para uma requisição longa não começar com token quase expirado. */
const EXPIRY_MARGIN_MS = 60_000;

export class OAuthNotConnectedError extends SourceError {
  constructor(name: string) {
    super(`${name} não conectado — conecte em Conexões`, 501);
  }
}

/** O serviço recusou o refresh token (revogado ou expirado): só reconectando. */
export class OAuthReauthRequiredError extends SourceError {
  constructor(name: string) {
    super(`a autorização de ${name} expirou — conecte de novo em Conexões`, 409);
  }
}

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OAuthSpec {
  /** Nome para mensagens ao usuário ("Dropbox"). */
  name: string;
  clientIdEnv: string;
  /** Clientes públicos (PKCE puro) não têm secret. */
  clientSecretEnv?: string;
  refreshTokenEnv: string;
  endpoints(): { authUrl: string; tokenUrl: string; revokeUrl?: string };
  scope: string;
  /** Parâmetros extras da URL de autorização (ex.: `access_type=offline`). */
  authParams?: Record<string, string>;
  /** Como revogar no serviço; sem isso só esquece o token localmente. */
  revoke?(token: string, fetchFn: FetchFn): Promise<unknown>;
  /** Nome do parâmetro de scope (Dropbox usa `scope`, mas com outro formato; padrão `scope`). */
  scopeParam?: string;
}

export type FlowState = { status: 'idle' } | { status: 'pending' } | { status: 'connected' } | { status: 'error'; error: string };

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

export interface OAuthClient {
  readonly spec: OAuthSpec;
  configured(): boolean;
  connected(): boolean;
  start(redirectUri: string, now?: number): { ok: true; authUrl: string } | { ok: false; error: string };
  complete(input: { state: string | null; code: string | null; error: string | null }, now?: number): Promise<FlowState>;
  state(): FlowState;
  accessToken(now?: number): Promise<string>;
  invalidate(): void;
  disconnect(): Promise<void>;
  /** `fetch` com `Authorization: Bearer`, uma renovação forçada e nova tentativa em 401. */
  authedFetch(url: string | URL, init?: RequestInit): Promise<Response>;
  /** Testes: troca o `fetch`, o armazenamento do refresh token e zera o estado. */
  setFetchForTests(fn?: FetchFn): void;
  resetForTests(): void;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

export const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
};

export const createOAuthClient = (spec: OAuthSpec): OAuthClient => {
  let fetchImpl: FetchFn = (input, init) => fetch(input, init);
  let cache: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;
  let flowState: FlowState = { status: 'idle' };
  const pending = new Map<string, { verifier: string; redirectUri: string; expiresAt: number }>();

  const clientId = () => readSetting(spec.clientIdEnv);
  const clientSecret = () => (spec.clientSecretEnv ? readSetting(spec.clientSecretEnv) : undefined);
  const refreshToken = () => readSetting(spec.refreshTokenEnv);
  const configured = () => Boolean(clientId() && (!spec.clientSecretEnv || clientSecret()));

  const postToken = async (params: Record<string, string>): Promise<TokenResponse & { status: number }> => {
    const body = { client_id: clientId() ?? '', ...(clientSecret() ? { client_secret: clientSecret() as string } : {}), ...params };
    const res = await fetchImpl(spec.endpoints().tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    return { ...json, status: res.status };
  };

  const remember = (token: string, expiresIn: number | undefined, now: number) => {
    cache = { token, expiresAt: now + (expiresIn ?? 3600) * 1000 };
  };

  const refresh = async (now: number): Promise<string> => {
    const stored = refreshToken();
    if (!configured() || !stored) throw new OAuthNotConnectedError(spec.name);
    const result = await postToken({ refresh_token: stored, grant_type: 'refresh_token' });
    if (result.error === 'invalid_grant') {
      cache = null;
      throw new OAuthReauthRequiredError(spec.name);
    }
    if (result.status !== 200 || !result.access_token) throw new SourceError(`não foi possível renovar o acesso a ${spec.name} agora`, 502);
    // Alguns serviços (OneDrive, Trakt) giram o refresh token a cada renovação: o antigo deixa de valer.
    if (result.refresh_token && result.refresh_token !== stored) writeSetting(spec.refreshTokenEnv, result.refresh_token);
    remember(result.access_token, result.expires_in, now);
    return result.access_token;
  };

  const client: OAuthClient = {
    spec,
    configured,
    connected: () => configured() && Boolean(refreshToken()),
    state: () => flowState,

    start(redirectUri, now = Date.now()) {
      const id = clientId();
      if (!id || !configured()) return { ok: false, error: `informe as credenciais de ${spec.name} antes de conectar` };
      for (const [state, flow] of pending) if (flow.expiresAt <= now) pending.delete(state);
      const state = b64url(randomBytes(24));
      const { verifier, challenge } = createPkcePair();
      pending.clear();
      pending.set(state, { verifier, redirectUri, expiresAt: now + FLOW_TTL_MS });
      flowState = { status: 'pending' };
      const url = new URL(spec.endpoints().authUrl);
      url.search = new URLSearchParams({
        client_id: id,
        redirect_uri: redirectUri,
        response_type: 'code',
        [spec.scopeParam ?? 'scope']: spec.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...spec.authParams,
      }).toString();
      return { ok: true, authUrl: url.toString() };
    },

    /** `state` é de uso único: sem ele (ou repetido) o código é descartado — é o que impede um terceiro de injetar um código. */
    async complete(input, now = Date.now()) {
      const set = (next: FlowState): FlowState => {
        flowState = next;
        return next;
      };
      const fail = (error: string): FlowState => set({ status: 'error', error });

      const flow = input.state ? pending.get(input.state) : undefined;
      if (input.state) pending.delete(input.state);
      if (!flow || flow.expiresAt <= now) return fail('pedido de autorização desconhecido ou expirado — tente conectar de novo');
      if (input.error || !input.code) return fail(input.error === 'access_denied' ? `acesso negado em ${spec.name}` : `${spec.name} não devolveu o código de autorização`);

      const result = await postToken({ code: input.code, code_verifier: flow.verifier, grant_type: 'authorization_code', redirect_uri: flow.redirectUri }).catch(() => null);
      if (result?.status !== 200 || !result.access_token) return fail(`${spec.name} recusou o código de autorização`);
      if (!result.refresh_token) return fail(`${spec.name} não devolveu o refresh token — revogue o app na sua conta e conecte de novo`);

      writeSetting(spec.refreshTokenEnv, result.refresh_token);
      remember(result.access_token, result.expires_in, now);
      return set({ status: 'connected' });
    },

    /** Token válido; renova perto do vencimento (uma renovação por vez). */
    async accessToken(now = Date.now()) {
      if (cache && cache.expiresAt - EXPIRY_MARGIN_MS > now) return cache.token;
      refreshing ??= refresh(now).finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    invalidate() {
      cache = null;
    },

    async authedFetch(url, init = {}) {
      const call = async () =>
        fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await client.accessToken()}` } });
      let res = await call();
      if (res.status === 401) {
        client.invalidate();
        res = await call();
      }
      if (res.status === 401) throw new OAuthReauthRequiredError(spec.name);
      return res;
    },

    /** Revoga no serviço (melhor esforço) e esquece o token localmente. */
    async disconnect() {
      const token = refreshToken();
      writeSetting(spec.refreshTokenEnv, '');
      cache = null;
      pending.clear();
      flowState = { status: 'idle' };
      if (token && spec.revoke) await spec.revoke(token, fetchImpl).catch(() => undefined);
    },

    setFetchForTests(fn) {
      fetchImpl = fn ?? ((input, init) => fetch(input, init));
    },

    resetForTests() {
      cache = null;
      refreshing = null;
      pending.clear();
      flowState = { status: 'idle' };
    },
  };
  return client;
};
