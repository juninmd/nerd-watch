import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/server/config.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';
import { photoStore } from '../src/server/telegram-photos.ts';

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
    expect(detail.items[0].messageId).toBe('102'); // mais recente primeiro
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

describe('nome, foto, descrição e link do canal', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
  const originalDir = photoStore.dir;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nw-route-photos-'));
    photoStore.dir = () => dir;
    // A prévia pública devolve o HTML do fixture; a foto (CDN do Telegram) devolve bytes de PNG.
    globalThis.fetch = (async (url: URL | string) => (String(url).includes('avatar-teste.png') ? new Response(PNG) : htmlResponse(FIXTURE))) as unknown as typeof fetch;
  });

  afterEach(() => {
    photoStore.dir = originalDir;
    rmSync(dir, { recursive: true, force: true });
  });

  test('ao adicionar um canal público guarda o nome real, a descrição, o link e a foto', async () => {
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) });
    const body = await res.json();
    expect(body).toMatchObject({
      title: 'Canal de Teste',
      description: 'Série fictícia\nsegunda linha & mais',
      link: 'https://t.me/canalteste',
    });
    expect(body.posterUrl).toStartWith(`/api/telegram/channels/${body.titleId}/photo`);

    const photo = await telegramRoutes.request(`/channels/${body.titleId}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG);
  });

  test('a foto de um canal sem foto salva, ou com id inválido, dá 404', async () => {
    expect((await telegramRoutes.request('/channels/123e4567-e89b-42d3-a456-426614174000/photo')).status).toBe(404);
    expect((await telegramRoutes.request('/channels/..%2F..%2Fsegredo/photo')).status).toBe(404);
  });

  test('se a foto falhar, o nome e a descrição ainda são guardados', async () => {
    globalThis.fetch = (async (url: URL | string) => (String(url).includes('avatar-teste.png') ? new Response('x', { status: 500 }) : htmlResponse(FIXTURE))) as unknown as typeof fetch;
    const body = await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) })).json();
    expect(body.title).toBe('Canal de Teste');
    expect(body.posterUrl).toBeNull();
  });

  test('refresh-info completa canais antigos que só tinham o @', async () => {
    const db = openDb(':memory:');
    resetDbForTests(db);
    upsertTelegramChannel(db, { handle: 'canalteste', mode: 'public' });

    const res = await telegramRoutes.request('/channels/refresh-info', { method: 'POST' });
    expect(await res.json()).toEqual({ checked: 1, updated: 1 });
    const list = await (await telegramRoutes.request('/channels')).json();
    expect(list.channels[0]).toMatchObject({ title: 'Canal de Teste', description: 'Série fictícia\nsegunda linha & mais' });
    expect(list.channels[0].posterUrl).toContain('/photo');

    // Já completo: nada a refazer na próxima chamada.
    expect(await (await telegramRoutes.request('/channels/refresh-info', { method: 'POST' })).json()).toEqual({ checked: 0, updated: 0 });
  });
});

describe('miniaturas dos vídeos', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
  const originalDir = photoStore.dir;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nw-route-thumbs-'));
    photoStore.dir = () => dir;
  });

  afterEach(() => {
    photoStore.dir = originalDir;
    rmSync(dir, { recursive: true, force: true });
  });

  const mockTelegram = (thumbOk: boolean) => {
    globalThis.fetch = (async (url: URL | string) => {
      const u = String(url);
      if (u.includes('/file/thumb')) return thumbOk ? new Response(PNG) : new Response('x', { status: 500 });
      return htmlResponse(FIXTURE);
    }) as unknown as typeof fetch;
  };

  test('traz as miniaturas do CDN para o disco e passa a servi-las pela rota local', async () => {
    mockTelegram(true);
    const created = await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) })).json();
    const detail = await (await telegramRoutes.request(`/channels/${created.titleId}`)).json();
    const withThumb = detail.items.find((i: { messageId: string }) => i.messageId === '100');
    expect(withThumb.thumbnailUrl).toBe(`/api/telegram/channels/${created.titleId}/items/100/thumb`);

    const res = await telegramRoutes.request(`/channels/${created.titleId}/items/100/thumb`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('se o download falhar mantém a URL original e tenta de novo no refresh-info', async () => {
    mockTelegram(false);
    const created = await (await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'public' }) })).json();
    const before = await (await telegramRoutes.request(`/channels/${created.titleId}`)).json();
    expect(before.items.find((i: { messageId: string }) => i.messageId === '100').thumbnailUrl).toBe('https://cdn1.telesco.pe/file/thumb100.jpg');

    mockTelegram(true);
    expect((await (await telegramRoutes.request('/channels/refresh-info', { method: 'POST' })).json()).updated).toBe(1);
    const after = await (await telegramRoutes.request(`/channels/${created.titleId}`)).json();
    expect(after.items.find((i: { messageId: string }) => i.messageId === '100').thumbnailUrl).toContain('/thumb');
  });

  test('miniatura inexistente ou com id inválido dá 404', async () => {
    expect((await telegramRoutes.request('/channels/123e4567-e89b-42d3-a456-426614174000/items/1/thumb')).status).toBe(404);
    expect((await telegramRoutes.request('/channels/x/items/..%2F1/thumb')).status).toBe(404);
  });
});

describe('ordem dos vídeos do canal', () => {
  test('o detalhe lista do vídeo mais recente ao mais antigo, mesmo importado em ordem inversa', async () => {
    const db = openDb(':memory:');
    resetDbForTests(db);
    const ch = upsertTelegramChannel(db, { handle: 'canal_ordem', mode: 'public' });
    upsertTelegramItems(db, ch.id, ['9', '100', '20', '3'].map((messageId) => ({ messageId })));

    const body = await (await telegramRoutes.request(`/channels/${ch.id}`)).json();
    expect(body.items.map((i: { messageId: string }) => i.messageId)).toEqual(['100', '20', '9', '3']);
  });
});
