import { Hono } from 'hono';
import { config, driveClientConfigured, driveConnected } from '../config/config.ts';
import { updateEnvVar } from '../config/env-file.ts';
import { GOOGLE_CLIENT_ID_RE, GOOGLE_CLIENT_SECRET_RE } from '../credentials/registry.ts';
import { oauthCallbackPage } from '../http/html.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';
import { completeAuthFlow, disconnectDrive, getFlowState, startAuthFlow } from '../providers/drive/oauth.ts';

export const driveRoutes = new Hono();


const status = () => ({ clientConfigured: driveClientConfigured(), connected: driveConnected() });

const callbackUrl = (): string => `http://127.0.0.1:${config.port}/api/drive/oauth/callback`;

driveRoutes.get('/', (c) => c.json(status()));

driveRoutes.post('/settings', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : undefined;
    if (clientId !== undefined && !GOOGLE_CLIENT_ID_RE.test(clientId)) return c.json({ error: 'client ID inválido (termina em .apps.googleusercontent.com)' }, 400);
    if (clientSecret !== undefined && !GOOGLE_CLIENT_SECRET_RE.test(clientSecret)) return c.json({ error: 'client secret inválido' }, 400);

    // Outro client ID invalida o refresh token guardado (ele pertence ao client que o emitiu).
    if (clientId !== undefined && clientId !== config.drive.clientId && config.drive.refreshToken) await disconnectDrive();
    if (clientId !== undefined) {
      updateEnvVar('GOOGLE_CLIENT_ID', clientId);
      config.drive.clientId = clientId;
    }
    if (clientSecret !== undefined) {
      updateEnvVar('GOOGLE_CLIENT_SECRET', clientSecret);
      config.drive.clientSecret = clientSecret;
    }
    return c.json(status());
  }),
);

driveRoutes.post('/oauth/start', (c) => {
  const result = startAuthFlow(callbackUrl());
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ authUrl: result.authUrl });
});

driveRoutes.get('/oauth/status', (c) => c.json({ ...getFlowState(), ...status() }));

/** O Google redireciona o navegador para cá. O `state` de uso único é o que impede um terceiro de injetar um código. */
driveRoutes.get('/oauth/callback', async (c) => {
  const result = await completeAuthFlow({ state: c.req.query('state') ?? null, code: c.req.query('code') ?? null, error: c.req.query('error') ?? null });
  return result.status === 'connected'
    ? oauthCallbackPage('Google Drive conectado', 'Pode fechar esta aba e voltar ao nerd-watch.')
    : oauthCallbackPage('Não foi possível conectar', result.status === 'error' ? result.error : 'tente novamente em Conexões.');
});

driveRoutes.post('/logout', async (c) => {
  await disconnectDrive();
  return c.json(status());
});
