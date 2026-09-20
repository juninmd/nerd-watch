import { Hono } from 'hono';
import { config, telegramBotEnabled, telegramPersonalEnabled } from '../config.ts';
import { updateEnvVar } from '../env-file.ts';
import { cancelLogin, getLoginState, startLogin, submitLoginPassword } from '../providers/telegram/qr-login.ts';
import { startTelegramBotPoller } from '../telegram-bot-poller.ts';

export const telegramSettingsRoutes = new Hono();

const statusResponse = () => ({
  botTokenConfigured: telegramBotEnabled(),
  apiCredentialsConfigured: Boolean(config.telegram.apiId && config.telegram.apiHash),
  personalConfigured: telegramPersonalEnabled(),
});

telegramSettingsRoutes.get('/', (c) => c.json(statusResponse()));

telegramSettingsRoutes.post('/', async (c) => {
  const body = await c.req.json<{ botToken?: string; apiId?: number | string; apiHash?: string }>().catch(() => null);
  if (!body) return c.json({ error: 'corpo inválido' }, 400);

  if (body.botToken !== undefined) {
    const token = String(body.botToken).trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return c.json({ error: 'token do bot inválido (formato esperado: 123456:ABC-...)' }, 400);
    updateEnvVar('TELEGRAM_BOT_TOKEN', token);
    config.telegram.botToken = token;
    startTelegramBotPoller();
  }

  if (body.apiId !== undefined) {
    const apiId = Number(body.apiId);
    if (!Number.isInteger(apiId) || apiId <= 0) return c.json({ error: 'api_id inválido' }, 400);
    updateEnvVar('TELEGRAM_API_ID', String(apiId));
    config.telegram.apiId = apiId;
  }

  if (body.apiHash !== undefined) {
    const apiHash = String(body.apiHash).trim();
    if (!/^[a-f0-9]{32}$/i.test(apiHash)) return c.json({ error: 'api_hash inválido (deve ter 32 caracteres hexadecimais)' }, 400);
    updateEnvVar('TELEGRAM_API_HASH', apiHash);
    config.telegram.apiHash = apiHash;
  }

  return c.json(statusResponse());
});

telegramSettingsRoutes.post('/login/start', (c) => {
  const result = startLogin();
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

telegramSettingsRoutes.get('/login/status', (c) => c.json(getLoginState()));

telegramSettingsRoutes.post('/login/password', async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => null);
  if (!body?.password) return c.json({ error: 'senha obrigatória' }, 400);
  const ok = submitLoginPassword(body.password);
  if (!ok) return c.json({ error: 'nenhum login aguardando senha' }, 409);
  return c.json({ ok: true });
});

telegramSettingsRoutes.post('/login/cancel', (c) => {
  cancelLogin();
  return c.json({ ok: true });
});
