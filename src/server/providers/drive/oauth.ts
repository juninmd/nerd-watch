import { createHash, randomBytes } from 'node:crypto';
import { config, driveClientConfigured } from '../../config.ts';
import { updateEnvVar } from '../../env-file.ts';

/** Só leitura: o app lista e baixa vídeos, nunca escreve nem apaga nada no Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

const FLOW_TTL_MS = 10 * 60_000;
/** Renova um pouco antes do vencimento para uma requisição longa não começar com token quase expirado. */
const EXPIRY_MARGIN_MS = 60_000;

export class DriveNotConnectedError extends Error {
  constructor(message = 'Google Drive não conectado — conecte em Conexões') {
    super(message);
  }
}

/** O Google recusou o refresh token (revogado, expirado ou app em "Testing" há mais de 7 dias): precisa reconectar. */
export class DriveReauthRequiredError extends Error {
  constructor() {
    super('a autorização do Google Drive expirou — conecte de novo em Conexões');
  }
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const base64Url = (buf: Buffer): string => buf.toString('base64url');

export const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = base64Url(randomBytes(48));
  return { verifier, challenge: base64Url(createHash('sha256').update(verifier).digest()) };
};

export const buildAuthUrl = (input: { clientId: string; redirectUri: string; state: string; challenge: string }): string => {
  const url = new URL(config.driveEndpoints.authUrl);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    // Sem `consent` o Google só devolve refresh token na primeira autorização da conta.
    prompt: 'consent',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

const postToken = async (params: Record<string, string>, fetchFn: FetchFn): Promise<TokenResponse & { status: number }> => {
  const res = await fetchFn(config.driveEndpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ...body, status: res.status };
};

/** Persistência do refresh token: `.env` (0600) como o `TELEGRAM_SESSION`. Injetável nos testes. */
export interface TokenStore {
  save(refreshToken: string): void;
  clear(): void;
}

const envStore: TokenStore = {
  save: (token) => {
    updateEnvVar('GOOGLE_DRIVE_REFRESH_TOKEN', token);
    config.drive.refreshToken = token;
  },
  clear: () => {
    updateEnvVar('GOOGLE_DRIVE_REFRESH_TOKEN', '');
    config.drive.refreshToken = undefined;
  },
};

let store: TokenStore = envStore;
export const setTokenStoreForTests = (next?: TokenStore): void => {
  store = next ?? envStore;
};

let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setDriveFetchForTests = (next?: FetchFn): void => {
  fetchImpl = next ?? ((input, init) => fetch(input, init));
};
export const driveFetch: FetchFn = (input, init) => fetchImpl(input, init);

// --- Fluxo de autorização (um por vez; é um app local de uma pessoa só) ---

type FlowState = { status: 'idle' } | { status: 'pending' } | { status: 'connected' } | { status: 'error'; error: string };

interface PendingFlow {
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

const pending = new Map<string, PendingFlow>();
let flowState: FlowState = { status: 'idle' };

export const getFlowState = (): FlowState => flowState;

export const startAuthFlow = (redirectUri: string, now: number = Date.now()): { ok: true; authUrl: string } | { ok: false; error: string } => {
  if (!driveClientConfigured()) return { ok: false, error: 'informe o client ID e o client secret do Google antes de conectar' };
  for (const [state, flow] of pending) if (flow.expiresAt <= now) pending.delete(state);
  const state = base64Url(randomBytes(24));
  const { verifier, challenge } = createPkcePair();
  pending.clear();
  pending.set(state, { verifier, redirectUri, expiresAt: now + FLOW_TTL_MS });
  flowState = { status: 'pending' };
  // biome-ignore lint/style/noNonNullAssertion: driveClientConfigured() garante o clientId
  return { ok: true, authUrl: buildAuthUrl({ clientId: config.drive.clientId!, redirectUri, state, challenge }) };
};

/** Chamado pela rota de callback. `state` é de uso único: sem ele (ou repetido) o código é descartado. */
export const completeAuthFlow = async (input: { state: string | null; code: string | null; error: string | null }, now: number = Date.now()): Promise<FlowState> => {
  const set = (next: FlowState): FlowState => {
    flowState = next;
    return next;
  };
  const fail = (error: string): FlowState => set({ status: 'error', error });

  const flow = input.state ? pending.get(input.state) : undefined;
  if (input.state) pending.delete(input.state);
  if (!flow || flow.expiresAt <= now) return fail('pedido de autorização desconhecido ou expirado — tente conectar de novo');
  if (input.error || !input.code) return fail(input.error === 'access_denied' ? 'acesso negado no Google' : 'o Google não devolveu o código de autorização');

  const result = await postToken(
    {
      client_id: config.drive.clientId ?? '',
      client_secret: config.drive.clientSecret ?? '',
      code: input.code,
      code_verifier: flow.verifier,
      grant_type: 'authorization_code',
      redirect_uri: flow.redirectUri,
    },
    driveFetch,
  ).catch(() => null);

  if (result?.status !== 200 || !result.access_token) return fail('o Google recusou o código de autorização');
  if (!result.refresh_token) return fail('o Google não devolveu o refresh token — revogue o app em myaccount.google.com/permissions e conecte de novo');

  store.save(result.refresh_token);
  cache = { token: result.access_token, expiresAt: now + (result.expires_in ?? 3600) * 1000 };
  return set({ status: 'connected' });
};

// --- Access token ---

let cache: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;

const refresh = async (now: number): Promise<string> => {
  if (!driveClientConfigured() || !config.drive.refreshToken) throw new DriveNotConnectedError();
  const result = await postToken(
    {
      client_id: config.drive.clientId ?? '',
      client_secret: config.drive.clientSecret ?? '',
      refresh_token: config.drive.refreshToken,
      grant_type: 'refresh_token',
    },
    driveFetch,
  );
  if (result.error === 'invalid_grant') {
    cache = null;
    throw new DriveReauthRequiredError();
  }
  if (result.status !== 200 || !result.access_token) throw new Error('não foi possível renovar o acesso ao Google Drive agora');
  cache = { token: result.access_token, expiresAt: now + (result.expires_in ?? 3600) * 1000 };
  return result.access_token;
};

/** Token de acesso válido; renova com o refresh token quando perto de vencer (uma renovação por vez). */
export const getAccessToken = async (now: number = Date.now()): Promise<string> => {
  if (cache && cache.expiresAt - EXPIRY_MARGIN_MS > now) return cache.token;
  refreshing ??= refresh(now).finally(() => {
    refreshing = null;
  });
  return refreshing;
};

/** Só para testes: zera token em cache, fluxo pendente e estado. */
export const resetDriveAuthForTests = (): void => {
  cache = null;
  refreshing = null;
  pending.clear();
  flowState = { status: 'idle' };
};

export const invalidateAccessToken = (): void => {
  cache = null;
};

/** Desconecta: revoga no Google (melhor esforço) e esquece o token localmente. */
export const disconnectDrive = async (): Promise<void> => {
  const token = config.drive.refreshToken;
  store.clear();
  cache = null;
  pending.clear();
  flowState = { status: 'idle' };
  if (!token) return;
  await driveFetch(config.driveEndpoints.revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
};
