import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../src/server/config.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { resetDriveAuthForTests, setDriveFetchForTests, setTokenStoreForTests } from '../src/server/providers/drive/oauth.ts';
import { driveRoutes } from '../src/server/routes/drive.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123';
const original = { ...config.drive };

const post = (path: string, body: unknown) => driveRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

let videos: Array<{ id: string; name: string; createdTime: string }> = [];

/** Google falso: token, pasta, listagem e download. */
const fakeGoogle = async (url: URL | string | Request, init?: RequestInit): Promise<Response> => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/token')) return json({ access_token: 'acc-1', expires_in: 3600 });
  if (u.pathname.endsWith(`/files/${ID}`)) return json({ id: ID, name: 'Bleach TYBW', mimeType: 'application/vnd.google-apps.folder' });
  if (u.pathname.endsWith('/files')) return json({ files: videos.map((v) => ({ ...v, mimeType: 'video/mp4', videoMediaMetadata: { durationMillis: '60000' }, thumbnailLink: 'https://lh3.googleusercontent.com/x=s220' })) });
  if (u.searchParams.get('alt') === 'media') {
    const range = new Headers(init?.headers).get('Range');
    return range ? new Response('xyz', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 5-7/100', 'Content-Length': '3' } }) : new Response('full', { headers: { 'Content-Type': 'video/mp4' } });
  }
  return json({}, 404);
};

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  resetDriveAuthForTests();
  Object.assign(config.drive, { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-123', refreshToken: 'ref' });
  setTokenStoreForTests({ save: () => {}, clear: () => {} });
  setDriveFetchForTests(fakeGoogle);
  videos = [
    { id: 'file-old-000001', name: 'Ep 08.mp4', createdTime: '2026-09-12T12:00:00.000Z' },
    { id: 'file-new-000002', name: 'Ep 09.mp4', createdTime: '2026-10-19T12:00:00.000Z' },
  ];
});

afterEach(() => {
  setDriveFetchForTests();
  setTokenStoreForTests();
  Object.assign(config.drive, original);
});

describe('GET /api/drive', () => {
  test('mostra só o estado, sem expor client secret nem token', async () => {
    const res = await driveRoutes.request('/');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ clientConfigured: true, connected: true });
    expect(text).not.toContain('GOCSPX');
    expect(text).not.toContain('ref');
  });
});

describe('POST /api/drive/settings — validação (não chega a gravar no .env real)', () => {
  test('rejeita client ID e client secret em formato inválido', async () => {
    expect((await post('/settings', { clientId: 'qualquer-coisa' })).status).toBe(400);
    expect((await post('/settings', { clientSecret: 'curto' })).status).toBe(400);
    expect((await driveRoutes.request('/settings', { method: 'POST', body: 'não é json' })).status).toBe(400);
  });
});

describe('OAuth', () => {
  test('callback com state desconhecido não conecta nada e mostra erro', async () => {
    const res = await driveRoutes.request('/oauth/callback?state=forjado&code=abc');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Não foi possível conectar');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  test('sem client configurado o start responde 400', async () => {
    Object.assign(config.drive, { clientId: undefined, clientSecret: undefined });
    expect((await post('/oauth/start', {})).status).toBe(400);
  });

  test('o start devolve a URL do Google com o redirect para o próprio app', async () => {
    const res = await post('/oauth/start', {});
    const { authUrl } = (await res.json()) as { authUrl: string };
    const url = new URL(authUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${config.port}/api/drive/oauth/callback`);
    expect(url.searchParams.get('client_id')).toBe('1-a.apps.googleusercontent.com');
    expect(authUrl).not.toContain('GOCSPX');
  });
});

describe('POST /api/drive/folders', () => {
  test('rejeita link que não é do Drive', async () => {
    expect((await post('/folders', { folder: 'https://evil.example/x' })).status).toBe(400);
    expect((await post('/folders', {})).status).toBe(400);
  });

  test('sem conexão com o Drive responde 501', async () => {
    config.drive.refreshToken = undefined;
    expect((await post('/folders', { folder: ID })).status).toBe(501);
  });

  test('importa a pasta como canal "drive" com os vídeos do mais novo ao mais antigo na API', async () => {
    const res = await post('/folders', { folder: `https://drive.google.com/drive/folders/${ID}` });
    expect(res.status).toBe(201);
    const channel = (await res.json()) as { titleId: string; mode: string; title: string; itemCount: number; link: string };
    expect(channel).toMatchObject({ mode: 'drive', title: 'Bleach TYBW', itemCount: 2, link: `https://drive.google.com/drive/folders/${ID}` });

    const detail = (await (await telegramRoutes.request(`/channels/${channel.titleId}`)).json()) as { items: Array<{ caption: string }> };
    expect(detail.items.map((i) => i.caption)).toEqual(['Ep 09', 'Ep 08']);
  });

  test('miniatura que não virou arquivo local não deixa o link temporário do Google para o navegador', async () => {
    const res = await post('/folders', { folder: ID });
    const { titleId } = (await res.json()) as { titleId: string };
    const detail = (await (await telegramRoutes.request(`/channels/${titleId}`)).json()) as { items: Array<{ thumbnailUrl: string | null }> };
    // banco em memória não tem pasta de miniaturas: o download é descartado e o link remoto some
    expect(detail.items.map((i) => i.thumbnailUrl)).toEqual([null, null]);
  });

  test('importar de novo não duplica o canal nem os vídeos', async () => {
    await post('/folders', { folder: ID });
    const again = await post('/folders', { folder: ID });
    expect(((await again.json()) as { itemCount: number }).itemCount).toBe(2);
    const list = (await (await telegramRoutes.request('/channels')).json()) as { channels: unknown[] };
    expect(list.channels).toHaveLength(1);
  });

  test('Drive fora do ar vira 502 genérico; reconectar vira 409', async () => {
    setDriveFetchForTests(async (url) => (String(url).includes('/token') ? json({ access_token: 'a', expires_in: 3600 }) : new Response('boom', { status: 500 })));
    const res = await post('/folders', { folder: ID });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('boom');

    resetDriveAuthForTests();
    setDriveFetchForTests(async () => json({ error: 'invalid_grant' }, 400));
    expect((await post('/folders', { folder: ID })).status).toBe(409);
  });
});

describe('atualizar e tocar um canal do Drive', () => {
  const importFolder = async () => ((await (await post('/folders', { folder: ID })).json()) as { titleId: string }).titleId;

  test('atualizar traz vídeos novos e remove os que saíram da pasta', async () => {
    const id = await importFolder();
    videos = [
      { id: 'file-new-000002', name: 'Ep 09.mp4', createdTime: '2026-10-19T12:00:00.000Z' },
      { id: 'file-nxt-000003', name: 'Ep 10.mp4', createdTime: '2026-10-26T12:00:00.000Z' },
    ];
    const res = await telegramRoutes.request(`/channels/${id}/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ itemCount: 2 });
    const detail = (await (await telegramRoutes.request(`/channels/${id}`)).json()) as { items: Array<{ caption: string }> };
    expect(detail.items.map((i) => i.caption)).toEqual(['Ep 10', 'Ep 09']);
  });

  test('tocar repassa o Range ao Drive e não expõe o ID do arquivo nem o token na resposta do canal', async () => {
    const id = await importFolder();
    const detailText = await (await telegramRoutes.request(`/channels/${id}`)).text();
    expect(detailText).not.toContain('file-new-000002');
    expect(detailText).not.toContain('acc-1');

    const detail = JSON.parse(detailText) as { items: Array<{ messageId: string }> };
    const messageId = detail.items[0]?.messageId;
    const res = await telegramRoutes.request(`/channels/${id}/items/${messageId}/play`, { headers: { Range: 'bytes=5-7' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 5-7/100');
    expect(await res.text()).toBe('xyz');
  });

  test('vídeo inexistente no canal responde 404', async () => {
    const id = await importFolder();
    expect((await telegramRoutes.request(`/channels/${id}/items/123/play`)).status).toBe(404);
  });

  test('o endpoint de canais do Telegram não aceita criar canal "drive"', async () => {
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'canalteste', mode: 'drive' }) });
    expect(res.status).toBe(400);
  });
});
