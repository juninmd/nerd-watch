import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setYoutubeFetchForTests } from '../src/server/providers/youtube/api.ts';
import { youtubeSource } from '../src/server/providers/youtube/source.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';

const CH = 'UCAAAAAAAAAAAAAAAAAAAAAA';
const HANDLE_PAGE = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${CH}"></head></html>`;
const FEED = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"><title>Canal Sintético</title>
 <entry><yt:videoId>BBBBBBBBBBB</yt:videoId><title>Vídeo &amp; dois</title><published>2026-10-19T12:00:00+00:00</published></entry>
 <entry><yt:videoId>CCCCCCCCCCC</yt:videoId><title>Vídeo três</title><published>2026-10-18T12:00:00+00:00</published></entry>
</feed>`;

let calls: string[] = [];
let respond: (url: string) => Response = () => new Response('', { status: 500 });

beforeEach(() => {
  calls = [];
  setYoutubeFetchForTests(async (url) => {
    calls.push(url);
    return respond(url);
  });
});

afterEach(() => setYoutubeFetchForTests());

const errorOf = async (promise: Promise<unknown>): Promise<SourceError> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SourceError) return err;
    throw err;
  }
  throw new Error('esperava um SourceError');
};

describe('resolve', () => {
  test('canal por ID cru: busca o feed e usa o título dele como nome', async () => {
    respond = () => new Response(FEED, { status: 200 });
    expect(await youtubeSource.resolve(CH)).toEqual({ handle: `youtube:channel:${CH}`, name: 'Canal Sintético' });
    expect(calls).toEqual([`https://www.youtube.com/feeds/videos.xml?channel_id=${CH}`]);
  });

  test('@handle: resolve o ID pela página e depois busca o feed', async () => {
    respond = (url) => (url.includes('/feeds/') ? new Response(FEED, { status: 200 }) : new Response(HANDLE_PAGE, { status: 200 }));
    expect((await youtubeSource.resolve('@Canal')).handle).toBe(`youtube:channel:${CH}`);
    expect(calls[0]).toBe('https://www.youtube.com/@Canal');
  });

  test('página do @handle sem ID dá mensagem clara de formato', async () => {
    respond = () => new Response('<html>outro layout</html>', { status: 200 });
    const err = await errorOf(youtubeSource.resolve('@Canal'));
    expect(err.status).toBe(502);
    expect(err.message).toContain('formato');
  });

  test('@handle inexistente vira 404 nosso', async () => {
    respond = () => new Response('not found', { status: 404 });
    expect((await errorOf(youtubeSource.resolve('@NaoExiste'))).status).toBe(404);
  });

  test('playlist: feed por playlist_id', async () => {
    const PL = 'PLbpi6ZahtOH6Ar_3GPy3workzyTkvbQdL';
    respond = () => new Response(FEED, { status: 200 });
    expect((await youtubeSource.resolve(PL)).handle).toBe(`youtube:playlist:${PL}`);
    expect(calls[0]).toContain(`playlist_id=${PL}`);
  });

  test('entrada que não é canal nem playlist nem @handle nem link: 400, sem rede', async () => {
    expect((await errorOf(youtubeSource.resolve('https://evil.example/channel/UCAAAAAAAAAAAAAAAAAAAAAA'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('feed com DOCTYPE é recusado e a mensagem não ecoa o XML', async () => {
    respond = () => new Response('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><feed>&e;</feed>', { status: 200 });
    const err = await errorOf(youtubeSource.resolve(CH));
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('passwd');
  });

  test('feed acima de 2 MB é recusado sem ser lido por inteiro', async () => {
    respond = () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { status: 200 });
    expect((await errorOf(youtubeSource.resolve(CH))).message).toContain('grande demais');
  });

  test('erro de rede vira 502 nosso', async () => {
    setYoutubeFetchForTests(async () => {
      throw new Error('ECONNRESET com detalhe interno');
    });
    const err = await errorOf(youtubeSource.resolve(CH));
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('ECONNRESET');
  });
});

describe('list / play / embed / thumb', () => {
  test('list devolve até os vídeos do feed, com miniatura no host fixo e sem duração', async () => {
    respond = () => new Response(FEED, { status: 200 });
    const items = await youtubeSource.list(`youtube:channel:${CH}`);
    expect(items.map((i) => i.fileRef)).toEqual(['BBBBBBBBBBB', 'CCCCCCCCCCC']);
    expect(items[0]).toMatchObject({ caption: 'Vídeo & dois', durationSeconds: null, thumbnailUrl: 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg' });
    expect(items[0]?.messageId).toMatch(/^\d+$/);
    expect(Number(items[0]?.messageId)).toBeGreaterThan(Number(items[1]?.messageId));
  });

  test('list de handle malformado no banco vira 400 sem rede', async () => {
    expect((await errorOf(youtubeSource.list('youtube:channel:../../x'))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('play nunca repassa vídeo: 501 com mensagem explicando o embed, sem chamada de rede', async () => {
    const err = await errorOf(youtubeSource.play({ handle: `youtube:channel:${CH}`, fileRef: 'BBBBBBBBBBB', range: 'bytes=0-9' }));
    expect(err.status).toBe(501);
    expect(err.message).toContain('embed');
    expect(calls).toHaveLength(0);
  });

  test('embedUrl só existe para ID de vídeo válido', () => {
    expect(youtubeSource.embedUrl?.('BBBBBBBBBBB')).toBe('https://www.youtube-nocookie.com/embed/BBBBBBBBBBB?rel=0');
    expect(youtubeSource.embedUrl?.('x" onload="alert(1)')).toBeNull();
  });

  test('miniatura baixa só do host fixo; fileRef malformado não gera requisição', async () => {
    respond = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
    expect(await youtubeSource.thumb?.({ handle: '', fileRef: 'BBBBBBBBBBB', thumbnailUrl: 'https://evil.example/x.jpg' })).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(calls).toEqual(['https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg']);
    calls = [];
    expect(await youtubeSource.thumb?.({ handle: '', fileRef: '../x', thumbnailUrl: null })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('link leva ao canal oficial', () => {
    expect(youtubeSource.link(`youtube:channel:${CH}`)).toBe(`https://www.youtube.com/channel/${CH}`);
    expect(youtubeSource.link('youtube:channel:lixo')).toBeNull();
  });
});
