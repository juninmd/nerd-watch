import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { childrenUrl, downloadOneDriveThumb, listFolderVideos, parseFolderPath } from '../src/server/providers/onedrive/api.ts';
import { onedriveOAuth } from '../src/server/providers/onedrive/oauth.ts';
import { onedriveSource } from '../src/server/providers/onedrive/source.ts';
import { setPlainFetchForTests } from '../src/server/providers/sources/http.ts';
import { registerAllSources } from '../src/server/providers/sources/index.ts';
import { getDescriptor } from '../src/server/providers/sources/registry.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';
import { type Call, fakeService, json } from './support/fake-service.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ID = 'D4A7B1C2E3F4A5B6!123';
const ID2 = '01BYE5RZ6QN3ZWBTUFOFD3GSPGOHDJD36K';
const token = { access_token: 'acc-1', expires_in: 3600, refresh_token: 'ref-1' };

beforeEach(() => {
  onedriveOAuth.resetForTests();
  process.env.ONEDRIVE_CLIENT_ID = 'cid-1234';
  process.env.ONEDRIVE_REFRESH_TOKEN = 'ref-0';
});

afterEach(() => {
  onedriveOAuth.setFetchForTests();
  setPlainFetchForTests();
  delete process.env.ONEDRIVE_CLIENT_ID;
  delete process.env.ONEDRIVE_REFRESH_TOKEN;
});

/** Token falso (com rotação: devolve um refresh token novo) + Graph falso. Devolve as chamadas registradas. */
const graphFake = (api: (call: Call) => Response | Promise<Response>): Call[] => {
  const service = fakeService((call) => (call.url.includes('/oauth2/v2.0/token') ? json(token) : api(call)));
  onedriveOAuth.setFetchForTests(service.fn);
  return service.calls;
};

const graphCalls = (calls: Call[]): Call[] => calls.filter((c) => c.url.startsWith(GRAPH));
const file = (id: string, name: string, created: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  createdDateTime: created,
  file: { mimeType: name.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream' },
  ...extra,
});

describe('parseFolderPath', () => {
  test.each([['/', []], ['/Vídeos', ['Vídeos']], ['Vídeos/Filmes/', ['Vídeos', 'Filmes']]])('aceita %j', (input, expected) => {
    expect(parseFolderPath(input)).toEqual(expected);
  });

  test.each(['..', '/a/../b', '/a?x=1', '/a#frag', '/a%2e%2e', '/a:b', '/a\\b', '/a /b', '/a\u0001b'])('recusa %j', (input) => {
    expect(parseFolderPath(input)).toBeNull();
  });

  test('codifica cada segmento na URL do Graph', () => {
    expect(childrenUrl(['Filmes & Séries'])).toBe(`${GRAPH}/me/drive/root:/Filmes%20%26%20S%C3%A9ries:/children`);
    expect(childrenUrl([])).toBe(`${GRAPH}/me/drive/root/children`);
  });
});

describe('resolve e list', () => {
  test('resolve confirma que é pasta e monta o handle', async () => {
    graphFake(() => json({ id: ID, name: 'Vídeos', folder: { childCount: 2 } }));
    expect(await onedriveSource.resolve('/Vídeos')).toEqual({ handle: 'onedrive:/Vídeos', name: 'Vídeos' });
  });

  test('arquivo no lugar de pasta vira 404', async () => {
    graphFake(() => json({ id: ID, name: 'filme.mp4', file: {} }));
    await expect(onedriveSource.resolve('/filme.mp4')).rejects.toMatchObject({ status: 404 });
  });

  test('erro do Graph vira mensagem nossa, sem o corpo', async () => {
    graphFake(() => new Response('token interno vazado', { status: 500 }));
    const error = await onedriveSource.resolve('/Vídeos').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, message: 'o OneDrive respondeu 500' });
    expect(String((error as Error).message)).not.toContain('vazado');
  });

  test('lista só vídeo (pasta e texto de fora), pela mesma ordem e com duração em segundos', async () => {
    const calls = graphFake(() =>
      json({
        value: [
          { id: 'folder-1', name: 'Pasta', createdDateTime: '2026-03-01T00:00:00Z', folder: {} },
          file('txt-1', 'notas.txt', '2026-03-02T00:00:00Z'),
          file(ID, 'Novo.mp4', '2026-02-01T00:00:00Z', { video: { duration: 8053 } }),
          file('bad id!!', 'ruim.mp4', '2026-02-02T00:00:00Z'),
        ],
      }),
    );
    const items = await onedriveSource.list('onedrive:/Vídeos');
    expect(items.map((i) => i.caption)).toEqual(['Novo']);
    expect(items[0]).toMatchObject({ fileRef: ID, durationSeconds: 8, thumbnailUrl: null });
    expect(graphCalls(calls)[0]?.url).toBe(`${GRAPH}/me/drive/root:/V%C3%ADdeos:/children?$top=200&$select=id,name,file,video,createdDateTime`);
  });

  test('pagina pelo @odata.nextLink e ordena do mais novo', async () => {
    let page = 0;
    graphFake(() => {
      page++;
      return page === 1
        ? json({ value: [file(ID2, 'antigo.mp4', '2026-01-01T00:00:00Z')], '@odata.nextLink': `${GRAPH}/me/drive/root/children?$skiptoken=abc` })
        : json({ value: [file(ID, 'novo.mkv', '2026-02-01T00:00:00Z')] });
    });
    expect((await listFolderVideos([])).map((v) => v.name)).toEqual(['novo.mkv', 'antigo.mp4']);
  });

  test('nextLink que sai do Graph é recusado e o Bearer nunca vai para outra origem', async () => {
    const calls = graphFake(() => json({ value: [], '@odata.nextLink': 'https://evil.example/steal' }));
    await expect(listFolderVideos([])).rejects.toMatchObject({ status: 502 });
    expect(calls.filter((c) => c.url.includes('evil.example'))).toHaveLength(0);
  });

  test('teto de 500 vídeos e de 50 páginas (nextLink que nunca acaba)', async () => {
    const value = Array.from({ length: 600 }, (_, i) => file(`ITEM${String(i).padStart(6, '0')}`, `v${i}.mp4`, new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()));
    graphFake(() => json({ value }));
    const capped = await listFolderVideos([]);
    expect(capped).toHaveLength(500);
    expect(capped[0]?.name).toBe('v599.mp4');

    const calls = graphFake(() => json({ value: [], '@odata.nextLink': `${GRAPH}/me/drive/root/children?$skiptoken=loop` }));
    await listFolderVideos([]);
    expect(calls.filter((c) => c.url.startsWith(GRAPH))).toHaveLength(50);
  });

  test('pasta sumida (404) vira 404 nosso', async () => {
    graphFake(() => new Response('', { status: 404 }));
    await expect(onedriveSource.list('onedrive:/nao-existe')).rejects.toMatchObject({ status: 404 });
  });

  test('handle fora do formato é recusado antes de qualquer chamada', async () => {
    const calls = graphFake(() => json({}));
    await expect(onedriveSource.list('onedrive:/a/../../etc')).rejects.toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
  });

  test('401 renova o token uma vez e repete a chamada', async () => {
    let n = 0;
    const calls = graphFake(() => (++n === 1 ? new Response('', { status: 401 }) : json({ value: [] })));
    expect(await listFolderVideos([])).toEqual([]);
    expect(calls.filter((c) => c.url.includes('/oauth2/v2.0/token'))).toHaveLength(2);
  });
});

describe('reprodução', () => {
  test('busca o downloadUrl com o Bearer, e o arquivo SEM Authorization e com Range', async () => {
    const calls = graphFake(() => json({ id: ID, '@microsoft.graph.downloadUrl': 'https://b0mpua.files.1drv.com/y23vmag' }));
    const plain: Call[] = [];
    setPlainFetchForTests(async (url, init) => {
      plain.push({ method: 'GET', url: String(url), headers: new Headers(init?.headers), body: '' });
      return new Response('bytes', { status: 206, headers: { 'Content-Range': 'bytes 0-3/9', 'Content-Type': 'video/mp4' } });
    });
    const res = await onedriveSource.play({ handle: 'onedrive:/V', fileRef: ID, range: 'bytes=0-3' });
    expect(res.status).toBe(206);
    expect(graphCalls(calls)[0]?.url).toBe(`${GRAPH}/me/drive/items/${ID}?select=id,@microsoft.graph.downloadUrl`);
    expect(graphCalls(calls)[0]?.headers.get('authorization')).toBe('Bearer acc-1');
    expect(plain[0]?.headers.get('range')).toBe('bytes=0-3');
    expect(plain[0]?.headers.get('authorization')).toBeNull();
  });

  test('downloadUrl que não é https vira 502', async () => {
    graphFake(() => json({ id: ID, '@microsoft.graph.downloadUrl': 'http://evil.example/x' }));
    await expect(onedriveSource.play({ handle: 'onedrive:/V', fileRef: ID, range: undefined })).rejects.toMatchObject({ status: 502 });
  });

  test('fileRef fora do formato não chega ao Graph', async () => {
    const calls = graphFake(() => json({}));
    await expect(onedriveSource.play({ handle: 'onedrive:/V', fileRef: '../x', range: undefined })).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });
});

describe('miniatura', () => {
  test('segue o 302 do Graph SEM Authorization', async () => {
    const calls = graphFake(() => new Response(null, { status: 302, headers: { Location: 'https://b0mpua.files.1drv.com/thumb.jpg' } }));
    const plain: Call[] = [];
    setPlainFetchForTests(async (url, init) => {
      plain.push({ method: 'GET', url: String(url), headers: new Headers(init?.headers), body: '' });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    });
    expect((await downloadOneDriveThumb(ID))?.length).toBe(3);
    expect(graphCalls(calls)[0]?.url).toBe(`${GRAPH}/me/drive/items/${ID}/thumbnails/0/medium/content`);
    expect(plain[0]?.headers.get('authorization')).toBeNull();
  });

  test('Location que não é https não é seguido', async () => {
    graphFake(() => new Response(null, { status: 302, headers: { Location: 'http://evil.example/t.jpg' } }));
    let plainCalled = false;
    setPlainFetchForTests(async () => {
      plainCalled = true;
      return new Response('x');
    });
    expect(await downloadOneDriveThumb(ID)).toBeNull();
    expect(plainCalled).toBe(false);
  });

  test('miniatura grande demais é descartada', async () => {
    graphFake(() => new Response(null, { status: 302, headers: { Location: 'https://b0mpua.files.1drv.com/big.jpg' } }));
    setPlainFetchForTests(async () => new Response(new Uint8Array(3 * 1024 * 1024), { status: 200, headers: { 'Content-Length': String(3 * 1024 * 1024) } }));
    expect(await downloadOneDriveThumb(ID)).toBeNull();
  });

  test('id inválido nem chega ao Graph', async () => {
    const calls = graphFake(() => json({}));
    expect(await downloadOneDriveThumb('../x')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('OAuth e registro', () => {
  test('refresh token gira: o novo substitui o antigo no próximo refresh', async () => {
    const calls = graphFake(() => json({}));
    await onedriveOAuth.accessToken(0);
    expect(process.env.ONEDRIVE_REFRESH_TOKEN).toBe('ref-1');
    await onedriveOAuth.accessToken(10_000_000);
    const refreshes = calls.filter((c) => c.url.includes('/token'));
    expect(refreshes[1]?.body).toContain('refresh_token=ref-1');
  });

  test('URL de autorização: conta pessoal, Files.Read + offline_access, sem secret', () => {
    const started = onedriveOAuth.start('http://localhost:7832/api/sources/onedrive/oauth/callback', 1_000);
    const url = new URL((started as { authUrl: string }).authUrl);
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe('Files.Read offline_access');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  test('desconectar não chama nenhum endpoint (sem revogação documentada) e esquece o token', async () => {
    const calls = graphFake(() => json({}));
    await onedriveOAuth.disconnect();
    expect(calls).toHaveLength(0);
    expect(process.env.ONEDRIVE_REFRESH_TOKEN).toBeUndefined();
  });

  test('descritor: só o client ID, redirect em localhost e guia com a redirect URI', () => {
    registerAllSources();
    const descriptor = getDescriptor('onedrive');
    expect(descriptor?.fields.map((f) => f.key)).toEqual(['clientId']);
    expect(descriptor?.redirectHost).toBe('localhost');
    expect(descriptor?.guide?.steps.some((s) => s.includes('{{redirectUri}}'))).toBe(true);
    expect(descriptor?.connected()).toBe(true);
  });
});
