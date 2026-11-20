import { Hono } from 'hono';
import { config, telegramBotEnabled, telegramPersonalEnabled } from '../config/config.ts';
import { API_HASH_RE, BOT_TOKEN_RE } from '../credentials/registry.ts';
import { updateEnvVar } from '../config/env-file.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';
import { getKnownPersonalAccount, getKnownPersonalAvatar, logoutPersonalSession, verifyPersonalSession } from '../providers/telegram/personal.ts';
import { cancelLogin, getLoginState, startLogin, submitLoginPassword } from '../providers/telegram/qr-login.ts';
import { startTelegramBotPoller } from '../telegram/bot-poller.ts';

export const telegramSettingsRoutes = new Hono();

const statusResponse = () => ({
  botTokenConfigured: telegramBotEnabled(),
  apiCredentialsConfigured: Boolean(config.telegram.apiId && config.telegram.apiHash),
  personalConfigured: telegramPersonalEnabled(),
  // Quem está logado: o nome vem da última verificação com o Telegram (null se ainda não houve uma).
  personalAccount: telegramPersonalEnabled() ? accountDto() : null,
});

/** Nome e @usuário; a foto vira uma URL com o photoId na query, então trocar a foto no Telegram invalida o cache do navegador. */
const accountDto = () => {
  const account = getKnownPersonalAccount();
  if (!account) return null;
  const avatarUrl = account.avatar ? `/api/telegram/settings/avatar?v=${encodeURIComponent(account.avatar.photoId)}` : null;
  return { name: account.name, username: account.username, avatarUrl };
};

telegramSettingsRoutes.get('/avatar', (c) => {
  const avatar = telegramPersonalEnabled() ? getKnownPersonalAvatar() : null;
  if (!avatar) return c.body(null, 404);
  return c.body(new Uint8Array(avatar.bytes), 200, { 'Content-Type': avatar.type, 'Cache-Control': 'private, max-age=300' });
});

telegramSettingsRoutes.get('/', async (c) => {
  // Uma session encerrada no app do Telegram continuaria aparecendo como "logada". Conferir custa uma conexão MTProto,
  // então só a tela de Conexões pede (`?verify=1`); a barra superior usa a leitura barata.
  if (c.req.query('verify') === '1') await verifyPersonalSession();
  return c.json(statusResponse());
});

telegramSettingsRoutes.post('/', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);

    if (body.botToken !== undefined) {
      if (typeof body.botToken !== 'string') return c.json({ error: 'token do bot inválido (formato esperado: 123456:ABC-...)' }, 400);
      const token = body.botToken.trim();
      if (!BOT_TOKEN_RE.test(token)) return c.json({ error: 'token do bot inválido (formato esperado: 123456:ABC-...)' }, 400);
      updateEnvVar('TELEGRAM_BOT_TOKEN', token);
      config.telegram.botToken = token;
      startTelegramBotPoller();
    }

    if (body.apiId !== undefined) {
      const apiId = typeof body.apiId === 'number' || typeof body.apiId === 'string' ? Number(body.apiId) : Number.NaN;
      if (!Number.isInteger(apiId) || apiId <= 0) return c.json({ error: 'api_id inválido' }, 400);
      updateEnvVar('TELEGRAM_API_ID', String(apiId));
      config.telegram.apiId = apiId;
    }

    if (body.apiHash !== undefined) {
      if (typeof body.apiHash !== 'string') return c.json({ error: 'api_hash inválido (deve ter 32 caracteres hexadecimais)' }, 400);
      const apiHash = body.apiHash.trim();
      if (!API_HASH_RE.test(apiHash)) return c.json({ error: 'api_hash inválido (deve ter 32 caracteres hexadecimais)' }, 400);
      updateEnvVar('TELEGRAM_API_HASH', apiHash);
      config.telegram.apiHash = apiHash;
    }

    return c.json(statusResponse());
  }),
);

telegramSettingsRoutes.post('/login/start', (c) => {
  const result = startLogin();
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

telegramSettingsRoutes.get('/login/status', (c) => c.json(getLoginState()));

telegramSettingsRoutes.post('/login/password', (c) =>
  guardInput(c, async () => {
    const body = await readJsonObject(c);
    if (typeof body.password !== 'string' || !body.password) return c.json({ error: 'senha obrigatória' }, 400);
    const ok = submitLoginPassword(body.password);
    if (!ok) return c.json({ error: 'nenhum login aguardando senha' }, 409);
    return c.json({ ok: true });
  }),
);

telegramSettingsRoutes.post('/login/cancel', (c) => {
  cancelLogin();
  return c.json({ ok: true });
});

telegramSettingsRoutes.post('/login/logout', async (c) => {
  cancelLogin();
  await logoutPersonalSession();
  return c.json(statusResponse());
});
