import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';

const FIXTURE = readFileSync(`${import.meta.dir}/fixtures/telegram-public-channel.html`, 'utf-8');
const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const htmlResponse = (body: string, status = 200): Response => new Response(body, { status });

describe('POST /api/telegram/channels', () => {
  test('rejeita handle inválido', async () => {
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'a', mode: 'public' }) });
    expect(res.status).toBe(400);
  });

  test('rejeita mode desconhecido', async () => {
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'zzz' }) });
    expect(res.status).toBe(400);
  });

  test('501 para modo personal/bot (ainda não implementados)', async () => {
    for (const mode of ['personal', 'bot']) {
      const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode }) });
      expect(res.status).toBe(501);
    }
  });

  test('modo público: cria o canal e importa os itens com vídeo da prévia', async () => {
    globalThis.fetch = (async () => htmlResponse(FIXTURE)) as unknown as typeof fetch;
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handle).toBe('canalteste');
    expect(body.itemCount).toBe(2);
  });

  test('404 quando o canal não existe/não é público', async () => {
    globalThis.fetch = (async () => htmlResponse('<html><body>nada aqui</body></html>')) as unknown as typeof fetch;
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'naoexiste', mode: 'public' }) });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/telegram/channels e /channels/:id', () => {
  test('lista canais e devolve os itens do canal', async () => {
    globalThis.fetch = (async () => htmlResponse(FIXTURE)) as unknown as typeof fetch;
    const created = await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) })).json();

    const list = await (await telegramRoutes.request('/channels')).json();
    expect(list.channels).toHaveLength(1);

    const detail = await (await telegramRoutes.request(`/channels/${created.titleId}`)).json();
    expect(detail.items).toHaveLength(2);
    expect(detail.items[0].messageId).toBe('100');
  });

  test('404 pra canal inexistente', async () => {
    const res = await telegramRoutes.request('/channels/inexistente');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/telegram/channels/:id/items/:messageId/play', () => {
  test('redireciona (302) pra URL de vídeo fresca no modo público', async () => {
    globalThis.fetch = (async () => htmlResponse(FIXTURE)) as unknown as typeof fetch;
    const created = await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) })).json();

    globalThis.fetch = (async () =>
      htmlResponse('<video src="https://cdn1.telesco.pe/file/fresh-token.mp4?token=novo"></video>')) as unknown as typeof fetch;
    const res = await telegramRoutes.request(`/channels/${created.titleId}/items/100/play`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn1.telesco.pe/file/fresh-token.mp4?token=novo');
  });
});
