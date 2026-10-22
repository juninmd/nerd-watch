import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { config } from '../src/server/config.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';

const FIXTURE = readFileSync(`${import.meta.dir}/fixtures/telegram-public-channel.html`, 'utf-8');
const originalFetch = globalThis.fetch;
const originalTelegramConfig = { ...config.telegram };

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  // Bun carrega .env automaticamente; sem isso, um .env real com credenciais (deixado por uso manual da UI)
  // muda o resultado desses testes — já aconteceu nesta sessão.
  Object.assign(config.telegram, { botToken: undefined, apiId: undefined, apiHash: undefined, session: undefined });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config.telegram, originalTelegramConfig);
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

  test('501 para modo personal/bot sem credenciais configuradas no ambiente de teste', async () => {
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

describe('DELETE /api/telegram/channels/:id', () => {
  const addPublic = async () => {
    globalThis.fetch = (async () => htmlResponse(FIXTURE)) as unknown as typeof fetch;
    return (await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) })).json()) as { titleId: string };
  };

  test('remove o canal, os vídeos e a entrada na lista', async () => {
    const created = await addPublic();
    await telegramRoutes.request(`/channels/${created.titleId}`); // sanity: existe antes
    const res = await telegramRoutes.request(`/channels/${created.titleId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    expect((await telegramRoutes.request(`/channels/${created.titleId}`)).status).toBe(404);
    expect((await (await telegramRoutes.request('/channels')).json()).channels).toHaveLength(0);
  });

  test('permite re-adicionar o mesmo canal depois de remover', async () => {
    const created = await addPublic();
    await telegramRoutes.request(`/channels/${created.titleId}`, { method: 'DELETE' });
    const again = await addPublic();
    expect(again.titleId).toBeTruthy();
    expect((await (await telegramRoutes.request('/channels')).json()).channels).toHaveLength(1);
  });

  test('404 para canal inexistente', async () => {
    const res = await telegramRoutes.request('/channels/nao-existe', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'canal não encontrado' });
  });
});

describe('POST /api/telegram/channels/bulk-delete', () => {
  const add = async (handle: string) => {
    globalThis.fetch = (async () => htmlResponse(FIXTURE)) as unknown as typeof fetch;
    return (await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle, mode: 'public' }) })).json()) as { titleId: string };
  };
  const bulk = (body: unknown) => telegramRoutes.request('/channels/bulk-delete', { method: 'POST', body: JSON.stringify(body) });

  test('remove só os ids pedidos e ignora ids inexistentes', async () => {
    const a = await add('canal_a1');
    const b = await add('canal_b2');
    const keep = await add('canal_c3');

    const res = await bulk({ ids: [a.titleId, b.titleId, 'nao-existe'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 2 });

    const left = (await (await telegramRoutes.request('/channels')).json()).channels;
    expect(left.map((c: { titleId: string }) => c.titleId)).toEqual([keep.titleId]);
  });

  test('rejeita corpo inválido, lista vazia e excesso de ids', async () => {
    expect((await bulk({})).status).toBe(400);
    expect((await bulk({ ids: [] })).status).toBe(400);
    expect((await bulk({ ids: [1, 2] })).status).toBe(400);
    expect((await bulk({ ids: Array.from({ length: 501 }, (_, i) => `id-${i}`) })).status).toBe(400);
  });
});

describe('GET /api/telegram/my-channels', () => {
  test('501 sem conta pessoal logada', async () => {
    const res = await telegramRoutes.request('/my-channels');
    expect(res.status).toBe(501);
  });
});

describe('GET /api/telegram/recent', () => {
  test('devolve o feed e limita o tamanho pedido', async () => {
    const db = openDb(':memory:');
    resetDbForTests(db);
    const ch = upsertTelegramChannel(db, { handle: 'canal_feed', mode: 'public', displayName: 'Canal Feed' });
    upsertTelegramItems(db, ch.id, Array.from({ length: 3 }, (_, i) => ({ messageId: String(i + 1), postedAt: `2026-02-0${i + 1}T00:00:00Z` })));

    const res = await telegramRoutes.request('/recent?limit=2');
    const body = await res.json();
    expect(body.items.map((i: { messageId: string }) => i.messageId)).toEqual(['3', '2']);
    expect(body.items[0]).toMatchObject({ channelTitle: 'Canal Feed', handle: 'canal_feed' });
  });

  test('limit inválido volta ao padrão em vez de falhar', async () => {
    expect((await telegramRoutes.request('/recent?limit=abc')).status).toBe(200);
  });
});
