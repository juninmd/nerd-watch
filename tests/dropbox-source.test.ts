import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { downloadDropboxThumb, listFolderVideos, normalizeFolderPath } from '../src/server/providers/dropbox/api.ts';
import { dropboxOAuth } from '../src/server/providers/dropbox/oauth.ts';
import { dropboxSource } from '../src/server/providers/dropbox/source.ts';
import { setPlainFetchForTests } from '../src/server/providers/sources/http.ts';
import { getDescriptor } from '../src/server/providers/sources/registry.ts';
import { registerAllSources } from '../src/server/providers/sources/index.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';
import { type Call, fakeService, json } from './support/fake-service.ts';

const ID_NEW = 'id:AAAAAAAAAAAAAAAAAAAAAN';
const ID_OLD = 'id:AAAAAAAAAAAAAAAAAAAAAO';
const file = (name: string, id: string, modified: string) => ({ '.tag': 'file', id, name, client_modified: modified });

beforeEach(() => {
  dropboxOAuth.resetForTests();
  process.env.DROPBOX_APP_KEY = 'appkey123';
  process.env.DROPBOX_REFRESH_TOKEN = 'ref-0';
});

afterEach(() => {
  dropboxOAuth.setFetchForTests();
  setPlainFetchForTests();
  delete process.env.DROPBOX_APP_KEY;
  delete process.env.DROPBOX_REFRESH_TOKEN;
});

/** Token falso (Dropbox não gira refresh token) + a API falsa. Devolve as chamadas registradas. */
const dropboxFake = (api: (call: Call) => Response | Promise<Response>): Call[] => {
  const service = fakeService((call) => (call.url.endsWith('/oauth2/token') ? json({ access_token: 'acc-1', expires_in: 14400 }) : api(call)));
  dropboxOAuth.setFetchForTests(service.fn);
  return service.calls;
};

const apiCalls = (calls: Call[], endpoint: string): Call[] => calls.filter((c) => c.url.endsWith(endpoint));

describe('normalizeFolderPath', () => {
  test.each(['/Vídeos', 'Vídeos/Filmes/', '  /Vídeos  '])('aceita %s', (input) => {
    expect(normalizeFolderPath(input)?.path.startsWith('/')).toBe(true);
  });

  test.each(['', '/', '..', '/a/../b', '/a/./b', '/a\\b', '/a\u0007b', '/a /b'])('recusa %j (traversal, controle, raiz)', (input) => {
    expect(normalizeFolderPath(input)).toBeNull();
  });
});

describe('resolve e list', () => {
  test('o handle é minúsculo (Dropbox não diferencia caixa) e o nome mantém o original', async () => {
    expect(await dropboxSource.resolve('/Vídeos/Filmes')).toEqual({ handle: 'dropbox:/vídeos/filmes', name: 'Filmes' });
  });

  test('caminho inválido vira 400 antes de qualquer requisição', async () => {
    const calls = dropboxFake(() => json({}));
    await expect(dropboxSource.resolve('/a/../b')).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });

  test('handle inválido rejeita (não lança síncrono) e não chama a API', async () => {
    const calls = dropboxFake(() => json({}));
    await expect(dropboxSource.list('dropbox:/a/../../etc')).rejects.toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
  });

  test('pagina com list_folder/continue, lista só vídeo e ordena do mais novo', async () => {
    const calls = dropboxFake((call) => {
      if (call.url.endsWith('/files/list_folder')) {
        return json({
          entries: [
            { '.tag': 'folder', id: 'id:FOLDERFOLDER1', name: 'Pasta', client_modified: '2026-03-01T00:00:00Z' },
            file('notas.txt', ID_NEW, '2026-03-01T00:00:00Z'),
            file('Novo.mp4', ID_NEW, '2026-02-01T00:00:00Z'),
            file('ruim.mp4', 'id:../etc', '2026-02-02T00:00:00Z'),
          ],
          cursor: 'c1',
          has_more: true,
        });
      }
      return json({ entries: [file('Velho.mkv', ID_OLD, '2026-01-01T00:00:00Z')], cursor: 'c2', has_more: false });
    });

    const items = await dropboxSource.list('dropbox:/vídeos');
    expect(items.map((i) => i.caption)).toEqual(['Novo', 'Velho']);
    expect(items.map((i) => i.fileRef)).toEqual([ID_NEW, ID_OLD]);
    expect(items.every((i) => i.thumbnailUrl === null && i.durationSeconds === null)).toBe(true);
    expect(JSON.parse(apiCalls(calls, '/files/list_folder')[0]?.body ?? '{}')).toMatchObject({ path: '/vídeos', recursive: false });
    expect(JSON.parse(apiCalls(calls, '/files/list_folder/continue')[0]?.body ?? '{}')).toEqual({ cursor: 'c1' });
  });

  test('teto de 500 vídeos, mantendo os mais novos', async () => {
    const entries = Array.from({ length: 600 }, (_, i) => file(`v${i}.mp4`, `id:FILE${String(i).padStart(8, '0')}`, new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()));
    dropboxFake(() => json({ entries, cursor: 'c', has_more: false }));
    const videos = await listFolderVideos('/vídeos');
    expect(videos).toHaveLength(500);
    expect(videos[0]?.name).toBe('v599.mp4');
  });

  test('páginas são limitadas: cursor que nunca acaba não vira loop infinito', async () => {
    const calls = dropboxFake((call) => json({ entries: [], cursor: `c-${call.url}`, has_more: true }));
    await listFolderVideos('/vídeos');
    expect(apiCalls(calls, '/files/list_folder/continue')).toHaveLength(49);
  });

  test('pasta inexistente vira 404 com a nossa mensagem', async () => {
    dropboxFake(() => json({ error_summary: 'path/not_found/..' }, 409));
    const error = await dropboxSource.list('dropbox:/nao-existe').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ status: 404, message: 'pasta não encontrada no Dropbox (confira o caminho e se a sua conta tem acesso)' });
  });

  test('erro do serviço nunca vaza o corpo cru', async () => {
    dropboxFake(() => new Response('stack interna segredo-xyz', { status: 500 }));
    const error = await dropboxSource.list('dropbox:/vídeos').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, message: 'o Dropbox respondeu 500' });
    expect(String((error as Error).message)).not.toContain('segredo');
  });

  test('falha de rede vira 502 nosso', async () => {
    dropboxOAuth.setFetchForTests(async (url) => {
      if (String(url).endsWith('/oauth2/token')) return json({ access_token: 'acc-1', expires_in: 14400 });
      throw new TypeError('socket hang up');
    });
    await expect(dropboxSource.list('dropbox:/vídeos')).rejects.toMatchObject({ status: 502 });
  });

  test('401 renova o token uma vez e repete a chamada', async () => {
    let listed = 0;
    const calls = dropboxFake(() => (++listed === 1 ? new Response('', { status: 401 }) : json({ entries: [], cursor: 'c', has_more: false })));
    expect(await dropboxSource.list('dropbox:/vídeos')).toEqual([]);
    expect(calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(2);
  });
});

describe('play', () => {
  test('link temporário resolvido por reprodução; o Range vai ao link sem Authorization', async () => {
    const calls = dropboxFake((call) =>
      call.url.endsWith('/files/get_temporary_link') ? json({ link: 'https://uc1.dl.dropboxusercontent.com/cd/0/get/abc', metadata: {} }) : json({}),
    );
    const plainCalls: Call[] = [];
    setPlainFetchForTests(async (url, init) => {
      plainCalls.push({ method: 'GET', url: String(url), headers: new Headers(init?.headers), body: '' });
      return new Response('bytes', { status: 206, headers: { 'Content-Range': 'bytes 0-4/10', 'Content-Type': 'video/mp4' } });
    });

    const res = await dropboxSource.play({ handle: 'dropbox:/vídeos', fileRef: ID_NEW, range: 'bytes=0-4' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-4/10');
    expect(JSON.parse(apiCalls(calls, '/files/get_temporary_link')[0]?.body ?? '{}')).toEqual({ path: ID_NEW });
    expect(plainCalls[0]?.headers.get('range')).toBe('bytes=0-4');
    expect(plainCalls[0]?.headers.get('authorization')).toBeNull();
  });

  test('link de origem não https é recusado', async () => {
    dropboxFake(() => json({ link: 'http://evil.example/video.mp4' }));
    await expect(dropboxSource.play({ handle: 'dropbox:/v', fileRef: ID_NEW, range: undefined })).rejects.toMatchObject({ status: 502 });
  });

  test('arquivo removido (409 not_found) vira 404', async () => {
    dropboxFake(() => json({ error_summary: 'path/not_found/..' }, 409));
    await expect(dropboxSource.play({ handle: 'dropbox:/v', fileRef: ID_NEW, range: undefined })).rejects.toMatchObject({ status: 404 });
  });

  test('link expirado (410) do upstream vira 502 nosso, sem o corpo', async () => {
    dropboxFake(() => json({ link: 'https://uc1.dl.dropboxusercontent.com/x' }));
    setPlainFetchForTests(async () => new Response('gone', { status: 410 }));
    const res = await dropboxSource.play({ handle: 'dropbox:/v', fileRef: ID_NEW, range: undefined });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'a origem respondeu 410' });
  });

  test('fileRef fora do formato não chega à API', async () => {
    const calls = dropboxFake(() => json({}));
    await expect(dropboxSource.play({ handle: 'dropbox:/v', fileRef: '../../x', range: undefined })).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });
});

describe('miniatura', () => {
  test('pede jpeg w1024h768 pelo caminho do arquivo e devolve os bytes', async () => {
    const calls = dropboxFake(() => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 }));
    const bytes = await downloadDropboxThumb(ID_NEW);
    expect(bytes?.length).toBe(4);
    const arg = JSON.parse(apiCalls(calls, '/files/get_thumbnail_v2')[0]?.headers.get('dropbox-api-arg') ?? '{}');
    expect(arg).toEqual({ resource: { '.tag': 'path', path: ID_NEW }, format: { '.tag': 'jpeg' }, size: { '.tag': 'w1024h768' } });
  });

  test('miniatura grande demais (content-length) é descartada', async () => {
    dropboxFake(() => new Response(new Uint8Array(3 * 1024 * 1024), { status: 200, headers: { 'Content-Length': String(3 * 1024 * 1024) } }));
    expect(await downloadDropboxThumb(ID_NEW)).toBeNull();
  });

  test('miniatura grande demais sem content-length é cortada no meio do stream', async () => {
    const big = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3 * 1024 * 1024));
        controller.close();
      },
    });
    dropboxFake(() => new Response(big, { status: 200 }));
    expect(await downloadDropboxThumb(ID_NEW)).toBeNull();
  });

  test('fileRef inválido não chama a API', async () => {
    const calls = dropboxFake(() => json({}));
    expect(await downloadDropboxThumb('id:x/../y')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('OAuth e registro', () => {
  test('URL de autorização: PKCE S256, offline, só escopos de leitura, sem client secret', () => {
    const started = dropboxOAuth.start('http://localhost:7832/api/sources/dropbox/oauth/callback', 1_000);
    expect(started.ok).toBe(true);
    const url = new URL((started as { authUrl: string }).authUrl);
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'appkey123',
      token_access_type: 'offline',
      scope: 'files.metadata.read files.content.read',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  test('desconectar revoga com um access token novo (o endpoint de revogação não aceita refresh token)', async () => {
    const calls = dropboxFake(() => json({}));
    await dropboxOAuth.disconnect();
    const token = apiCalls(calls, '/oauth2/token')[0];
    expect(token?.body).toContain('grant_type=refresh_token');
    expect(token?.body).toContain('refresh_token=ref-0');
    expect(apiCalls(calls, '/2/auth/token/revoke')[0]?.headers.get('authorization')).toBe('Bearer acc-1');
    expect(process.env.DROPBOX_REFRESH_TOKEN).toBeUndefined();
  });

  test('descritor: só a app key (sem secret), guia com a redirect URI, conectado quando há refresh token', () => {
    registerAllSources();
    const descriptor = getDescriptor('dropbox');
    expect(descriptor?.fields.map((f) => f.key)).toEqual(['appKey']);
    expect(descriptor?.fields.some((f) => f.secret)).toBe(false);
    expect(descriptor?.guide?.steps.some((s) => s.includes('{{redirectUri}}'))).toBe(true);
    expect(descriptor?.configured()).toBe(true);
    expect(descriptor?.connected()).toBe(true);
  });
});
