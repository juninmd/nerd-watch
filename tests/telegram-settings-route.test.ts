import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/server/config.ts';
import { telegramSettingsRoutes } from '../src/server/routes/telegram-settings.ts';

const post = (path: string, body: unknown) =>
  telegramSettingsRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const originalTelegramConfig = { ...config.telegram };

beforeEach(() => {
  // Bun carrega .env automaticamente; sem isso, um .env real com credenciais (deixado por uso manual da UI)
  // muda o resultado desses testes (já aconteceu nesta sessão) e pode até abrir uma conexão MTProto real.
  Object.assign(config.telegram, { botToken: undefined, apiId: undefined, apiHash: undefined, session: undefined });
});

afterEach(() => {
  Object.assign(config.telegram, originalTelegramConfig);
});

describe('GET /api/telegram/settings', () => {
  test('devolve o status sem expor nenhum segredo', async () => {
    const res = await telegramSettingsRoutes.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      botTokenConfigured: expect.any(Boolean),
      apiCredentialsConfigured: expect.any(Boolean),
      personalConfigured: expect.any(Boolean),
    });
  });
});

describe('POST /api/telegram/settings — validação (não deve chegar a gravar no .env real)', () => {
  test('rejeita token de bot em formato inválido', async () => {
    const res = await post('/', { botToken: 'não-é-um-token' });
    expect(res.status).toBe(400);
  });

  test('rejeita api_id inválido', async () => {
    const res = await post('/', { apiId: -1 });
    expect(res.status).toBe(400);
  });

  test('rejeita api_hash com formato errado', async () => {
    const res = await post('/', { apiHash: 'muito-curto' });
    expect(res.status).toBe(400);
  });

  test('400 quando o corpo não é JSON válido', async () => {
    const res = await telegramSettingsRoutes.request('/', { method: 'POST', body: 'não é json' });
    expect(res.status).toBe(400);
  });
});

describe('login por QR code', () => {
  test('login/start falha sem api_id/api_hash configurados', async () => {
    const res = await telegramSettingsRoutes.request('/login/start', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('login/status começa "idle" (nenhum login em andamento)', async () => {
    const res = await telegramSettingsRoutes.request('/login/status');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('idle');
  });

  test('login/password sem login pendente devolve 409', async () => {
    const res = await post('/login/password', { password: 'x' });
    expect(res.status).toBe(409);
  });

  test('login/password sem senha no corpo devolve 400', async () => {
    const res = await post('/login/password', {});
    expect(res.status).toBe(400);
  });

  test('login/cancel é inofensivo mesmo sem login em andamento', async () => {
    const res = await telegramSettingsRoutes.request('/login/cancel', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
