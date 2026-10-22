import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chooseFile, setPeertubeFetchForTests, thumbUrlOf } from '../src/server/providers/peertube/api.ts';
import { peertubeSource } from '../src/server/providers/peertube/source.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';

const HOST = 'video.example.org';
const HANDLE = `peertube:canal@${HOST}`;
const file = (url: string, id: number) => ({ fileUrl: url, resolution: { id, label: `${id}p` } });
let calls: Array<{ url: string; init?: RequestInit }> = [];
let respond: (url: string, init?: RequestInit) => Response | Promise<Response> = () => new Response('', { status: 500 });

beforeEach(() => {
  calls = [];
  setPeertubeFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  });
});

afterEach(() => setPeertubeFetchForTests());

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Quem chama vê só a mensagem nossa: a classe de erro e o status, nunca o corpo cru da instância. */
const errorOf = async (promise: Promise<unknown>): Promise<SourceError> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SourceError) return err;
    throw err;
  }
  throw new Error('esperava um SourceError');
};

describe('resolve (entrada do usuário)', () => {
  test('usa o displayName do canal e monta o handle com o host validado', async () => {
    respond = () => json({ name: 'canal', displayName: 'Canal Bonito', host: HOST });
    expect(await peertubeSource.resolve(`Canal@${HOST}`)).toEqual({ handle: `peertube:canal@${HOST}`, name: 'Canal Bonito' });
    expect(calls[0]?.url).toBe(`https://${HOST}/api/v1/video-channels/canal`);
  });

  test('canal inexistente vira 404 nosso, sem o corpo da instância', async () => {
    respond = () => new Response('<html>stack trace interno</html>', { status: 404 });
    const err = await errorOf(peertubeSource.resolve(`nao-existe@${HOST}`));
    expect(err.status).toBe(404);
    expect(err.message).not.toContain('stack');
  });

  test('erro da instância (500) vira 502 com mensagem nossa', async () => {
    respond = () => new Response('segredo do servidor', { status: 500 });
    const err = await errorOf(peertubeSource.resolve(`canal@${HOST}`));
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('segredo');
  });

  test('resposta que não é JSON não derruba o app', async () => {
    respond = () => new Response('<!doctype html>', { status: 200 });
    expect((await errorOf(peertubeSource.resolve(`canal@${HOST}`))).status).toBe(502);
  });

  test('SSRF: entrada hostil nunca gera requisição', async () => {
    for (const input of ['canal@localhost', 'canal@127.0.0.1', 'http://video.example.org/c/canal', `https://${HOST}:9000/c/canal`, 'canal@10.0.0.1']) {
      expect((await errorOf(peertubeSource.resolve(input))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('list (vídeos do canal)', () => {
  const video = (uuid: string, extra: Record<string, unknown> = {}) => ({
    uuid,
    name: `Vídeo ${uuid.slice(0, 4)}`,
    duration: 93.4,
    publishedAt: '2026-10-19T12:00:00.000Z',
    thumbnailPath: `/lazy-static/thumbnails/${uuid}.jpg`,
    ...extra,
  });
  const UUID_A = '11111111-1111-4111-8111-111111111111';
  const UUID_B = '22222222-2222-4222-8222-222222222222';

  test('pagina de 100 em 100 até o total e mapeia campos', async () => {
    respond = (url) => {
      const start = new URL(url).searchParams.get('start');
      return start === '0' ? json({ total: 150, data: Array.from({ length: 100 }, (_, i) => video(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`)) }) : json({ total: 150, data: [video(UUID_A)] });
    };
    const items = await peertubeSource.list(HANDLE);
    expect(items).toHaveLength(101);
    expect(calls.map((c) => new URL(c.url).searchParams.get('start'))).toEqual(['0', '100']);
    expect(calls[0]?.url).toContain('sort=-publishedAt');
    expect(items[100]).toMatchObject({ caption: 'Vídeo 1111', durationSeconds: 93, fileRef: UUID_A, postedAt: '2026-10-19T12:00:00.000Z' });
    expect(items[100]?.thumbnailUrl).toBe(`https://${HOST}/lazy-static/thumbnails/${UUID_A}.jpg`);
  });

  test('para no teto de 500 itens mesmo que a instância diga que tem mais', async () => {
    respond = (url) => {
      const start = Number(new URL(url).searchParams.get('start'));
      return json({ total: 10_000, data: Array.from({ length: 100 }, (_, i) => video(`${String(start + i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)) });
    };
    expect(await peertubeSource.list(HANDLE)).toHaveLength(500);
    expect(calls).toHaveLength(5);
  });

  test('ignora entrada malformada (uuid inválido, nome vazio) sem quebrar a lista', async () => {
    respond = () => json({ total: 3, data: [video('não-é-uuid'), video(UUID_B, { name: '  ', duration: -5, publishedAt: 'lixo' }), null] });
    const items = await peertubeSource.list(HANDLE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fileRef: UUID_B, caption: 'Vídeo sem título', durationSeconds: null, postedAt: null });
  });

  test('miniatura só pelo caminho padrão no mesmo host: nada de URL arbitrária vinda da API', () => {
    expect(thumbUrlOf(HOST, '//evil.example/x.jpg')).toBeNull();
    expect(thumbUrlOf(HOST, 'https://evil.example/x.jpg')).toBeNull();
    expect(thumbUrlOf(HOST, '/lazy-static/../../secret.jpg')).toBeNull();
    expect(thumbUrlOf(HOST, '/lazy-static/thumbnails/abc.jpg')).toBe(`https://${HOST}/lazy-static/thumbnails/abc.jpg`);
  });

  test('handle inválido no banco vira 400 antes de qualquer requisição', async () => {
    expect((await errorOf(peertubeSource.list('peertube:canal@127.0.0.1'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('chooseFile (qual arquivo tocar)', () => {
  test('pega o maior até 1080p, do próprio host, MP4 ou WebM', () => {
    const choice = chooseFile(HOST, [
      file(`https://${HOST}/static/a-720.mp4`, 720),
      file(`https://${HOST}/static/a-1080.webm`, 1080),
      file(`https://${HOST}/static/a-1440.mp4`, 1440),
    ]);
    expect(choice).toEqual({ kind: 'file', url: `https://${HOST}/static/a-1080.webm` });
  });

  test('sem nenhum até 1080p, usa o menor disponível', () => {
    expect(chooseFile(HOST, [file(`https://${HOST}/s/a-2160.mp4`, 2160), file(`https://${HOST}/s/a-1440.mp4`, 1440)])).toEqual({ kind: 'file', url: `https://${HOST}/s/a-1440.mp4` });
  });

  test('descarta "áudio apenas" (altura 0), outro host, http, credenciais e extensões que não são vídeo', () => {
    const choice = chooseFile(HOST, [
      file(`https://${HOST}/s/audio.mp4`, 0),
      file(`https://cdn.evil.example/s/a.mp4`, 1080),
      file(`http://${HOST}/s/a.mp4`, 1080),
      file(`https://user:pw@${HOST}/s/a.mp4`, 1080),
      file(`https://${HOST}/s/a.torrent`, 1080),
      file(`https://${HOST}:8443/s/a.mp4`, 1080),
    ]);
    expect(choice).toEqual({ kind: 'embed' });
  });

  test('sem arquivo direto (só HLS ou lista vazia) cai no embed', () => {
    expect(chooseFile(HOST, [])).toEqual({ kind: 'embed' });
    expect(chooseFile(HOST, undefined)).toEqual({ kind: 'embed' });
  });
});

describe('play (proxy com Range e fallback de embed)', () => {
  const UUID = '33333333-3333-4333-8333-333333333333';
  const fileUrl = `https://${HOST}/static/web-videos/${UUID}-1080.mp4`;

  const detail = (files: unknown[]) => json({ uuid: UUID, files, streamingPlaylists: [{ type: 1 }] });

  test('repassa o Range e devolve 206 com Content-Range, sem cabeçalhos do upstream', async () => {
    respond = (url) => {
      if (url.includes('/api/v1/videos/')) return detail([file(fileUrl, 1080)]);
      return new Response('0123456789', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-9/1000', 'X-Upstream-Secret': 'x' } });
    };
    const res = await peertubeSource.play({ handle: HANDLE, fileRef: UUID, range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-9/1000');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('X-Upstream-Secret')).toBeNull();
    expect(await res.text()).toBe('0123456789');
    const mediaCall = calls.find((c) => c.url === fileUrl);
    expect(new Headers(mediaCall?.init?.headers).get('Range')).toBe('bytes=0-9');
    expect(mediaCall?.init?.redirect).toBe('manual');
  });

  test('instância só com HLS responde 409 com o embed do próprio host (o app troca o player)', async () => {
    const HLS_UUID = '44444444-4444-4444-8444-444444444444';
    respond = () => json({ uuid: HLS_UUID, files: [], streamingPlaylists: [{ type: 1 }] });
    const res = await peertubeSource.play({ handle: HANDLE, fileRef: HLS_UUID, range: undefined });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'este vídeo só toca pelo site da instância', embedUrl: `https://${HOST}/videos/embed/${HLS_UUID}` });
  });

  test('redirecionamento do arquivo não é seguido: vira 502 nosso', async () => {
    const REDIR_UUID = '55555555-5555-4555-8555-555555555555';
    respond = (url) => (url.includes('/api/v1/videos/') ? detail([file(`https://${HOST}/s/r-1080.mp4`, 1080)]) : new Response('', { status: 302, headers: { Location: 'https://evil.example/x' } }));
    const res = await peertubeSource.play({ handle: HANDLE, fileRef: REDIR_UUID, range: undefined });
    expect(res.status).toBe(502);
    expect(res.headers.get('location')).toBeNull();
  });

  test('uuid malformado vira 404 antes de qualquer requisição', async () => {
    expect((await errorOf(peertubeSource.play({ handle: HANDLE, fileRef: '../../api/v1/users', range: undefined }))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('vídeo removido na instância vira 404 nosso', async () => {
    const GONE_UUID = '66666666-6666-4666-8666-666666666666';
    respond = () => new Response('gone', { status: 404 });
    expect((await errorOf(peertubeSource.play({ handle: HANDLE, fileRef: GONE_UUID, range: undefined }))).status).toBe(404);
  });

  test('o link do canal aponta para a instância validada', () => {
    expect(peertubeSource.link(HANDLE)).toBe(`https://${HOST}/video-channels/canal`);
    expect(peertubeSource.link('peertube:canal@127.0.0.1')).toBeNull();
  });
});

describe('thumb (miniatura baixada no servidor)', () => {
  test('baixa só do host do canal, e recusa URL de outro host', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    respond = () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    const ok = await peertubeSource.thumb?.({ handle: HANDLE, fileRef: null, thumbnailUrl: `https://${HOST}/lazy-static/thumbnails/a.jpg` });
    expect(ok).toEqual(bytes);
    expect(await peertubeSource.thumb?.({ handle: HANDLE, fileRef: null, thumbnailUrl: 'https://evil.example/lazy-static/thumbnails/a.jpg' })).toBeNull();
    expect(calls.some((c) => c.url.includes('evil.example'))).toBe(false);
  });

  test('miniatura acima de 2 MB é descartada sem guardar pedaço', async () => {
    respond = () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { status: 200 });
    expect(await peertubeSource.thumb?.({ handle: HANDLE, fileRef: null, thumbnailUrl: `https://${HOST}/lazy-static/thumbnails/big.jpg` })).toBeNull();
  });
});
