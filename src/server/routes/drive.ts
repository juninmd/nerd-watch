import { Hono } from 'hono';
import { config, driveClientConfigured, driveConnected } from '../config.ts';
import { updateEnvVar } from '../env-file.ts';
import { completeAuthFlow, disconnectDrive, getFlowState, startAuthFlow } from '../providers/drive/oauth.ts';

export const driveRoutes = new Hono();

const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
const CLIENT_SECRET_RE = /^[A-Za-z0-9_-]{10,120}$/;

const status = () => ({ clientConfigured: driveClientConfigured(), connected: driveConnected() });

const callbackUrl = (): string => `http://127.0.0.1:${config.port}/api/drive/oauth/callback`;

driveRoutes.get('/', (c) => c.json(status()));

driveRoutes.post('/settings', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; clientSecret?: unknown }>().catch(() => null);
  if (!body) return c.json({ error: 'corpo inválido' }, 400);

  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : undefined;
  if (clientId !== undefined && !CLIENT_ID_RE.test(clientId)) return c.json({ error: 'client ID inválido (termina em .apps.googleusercontent.com)' }, 400);
  if (clientSecret !== undefined && !CLIENT_SECRET_RE.test(clientSecret)) return c.json({ error: 'client secret inválido' }, 400);

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
});

driveRoutes.post('/oauth/start', (c) => {
  const result = startAuthFlow(callbackUrl());
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ authUrl: result.authUrl });
});

driveRoutes.get('/oauth/status', (c) => c.json({ ...getFlowState(), ...status() }));

const page = (title: string, message: string): Response =>
  new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<body style="font-family:system-ui;background:#0b0b12;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0"><main style="text-align:center;padding:24px"><h1>${title}</h1><p>${message}</p></main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  );

/** O Google redireciona o navegador para cá. O `state` de uso único é o que impede um terceiro de injetar um código. */
driveRoutes.get('/oauth/callback', async (c) => {
  const result = await completeAuthFlow({ state: c.req.query('state') ?? null, code: c.req.query('code') ?? null, error: c.req.query('error') ?? null });
  return result.status === 'connected'
    ? page('Google Drive conectado', 'Pode fechar esta aba e voltar ao nerd-watch.')
    : page('Não foi possível conectar', result.status === 'error' ? result.error : 'tente novamente em Conexões.');
});

driveRoutes.post('/logout', async (c) => {
  await disconnectDrive();
  return c.json(status());
});
