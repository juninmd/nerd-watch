import type { FetchFn } from '../oauth/client.ts';
import { createOAuthClient } from '../oauth/client.ts';
import { readSetting } from '../sources/settings.ts';

export const DROPBOX_APP_KEY_ENV = 'DROPBOX_APP_KEY';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke';

/** Só leitura: lista pastas e baixa/mostra vídeos. Nada de escrita. */
export const DROPBOX_SCOPE = 'files.metadata.read files.content.read';

/**
 * Dropbox não aceita revogar pelo refresh token: a revogação pede o access token. Trocamos o refresh por um access
 * token (o que também é o único jeito de usar a revogação) e revogamos com ele. Melhor esforço: falhas são ignoradas.
 */
const revokeDropbox = async (refreshToken: string, fetchFn: FetchFn): Promise<void> => {
  const appKey = readSetting(DROPBOX_APP_KEY_ENV);
  if (!appKey) return;
  const tokenRes = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!body.access_token) return;
  await fetchFn(REVOKE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${body.access_token}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
};

/** Cliente público (PKCE, sem client secret). `token_access_type=offline` é o que faz o Dropbox devolver refresh token. */
export const dropboxOAuth = createOAuthClient({
  name: 'Dropbox',
  clientIdEnv: DROPBOX_APP_KEY_ENV,
  refreshTokenEnv: 'DROPBOX_REFRESH_TOKEN',
  endpoints: () => ({ authUrl: 'https://www.dropbox.com/oauth2/authorize', tokenUrl: TOKEN_URL }),
  scope: DROPBOX_SCOPE,
  authParams: { token_access_type: 'offline' },
  revoke: revokeDropbox,
});
