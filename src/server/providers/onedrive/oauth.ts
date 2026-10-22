import { createOAuthClient } from '../oauth/client.ts';

export const ONEDRIVE_CLIENT_ID_ENV = 'ONEDRIVE_CLIENT_ID';

/** `consumers` = só contas Microsoft pessoais (OneDrive pessoal). Refresh token vem por `offline_access`. */
const LOGIN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

/** Só leitura dos arquivos do próprio usuário. */
export const ONEDRIVE_SCOPE = 'Files.Read offline_access';

/**
 * Cliente público (sem client secret). O refresh token gira a cada renovação: o `createOAuthClient` já grava o novo.
 * Não há `revoke`: não encontrei na documentação um endpoint para revogar refresh token; desconectar só esquece localmente.
 */
export const onedriveOAuth = createOAuthClient({
  name: 'OneDrive',
  clientIdEnv: ONEDRIVE_CLIENT_ID_ENV,
  refreshTokenEnv: 'ONEDRIVE_REFRESH_TOKEN',
  endpoints: () => ({ authUrl: `${LOGIN}/authorize`, tokenUrl: `${LOGIN}/token` }),
  scope: ONEDRIVE_SCOPE,
});
