import { createOAuthClient } from '../oauth/client.ts';

/**
 * Trakt usa authorization code (PKCE é suportado pela doc oficial). Os endpoints são os de `auth.trakt.tv`,
 * indicados por fontes da comunidade e NÃO confirmados na doc oficial (ver docs/providers/trakt.md).
 * O Trakt não tem escopos: o app inteiro tem acesso à conta, por isso o `scope` vai vazio.
 * Cada refresh gira o refresh token (uso único): o cliente genérico já grava o novo.
 */
export const traktOAuth = createOAuthClient({
  name: 'Trakt',
  clientIdEnv: 'TRAKT_CLIENT_ID',
  clientSecretEnv: 'TRAKT_CLIENT_SECRET',
  refreshTokenEnv: 'TRAKT_REFRESH_TOKEN',
  endpoints: () => ({
    authUrl: 'https://auth.trakt.tv/oauth/authorize',
    tokenUrl: 'https://auth.trakt.tv/oauth/token',
  }),
  scope: '',
});
