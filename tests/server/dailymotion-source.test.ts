import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setDailymotionFetchForTests } from '../../src/server/providers/dailymotion/api.ts';
import { parseDailymotionHandle, parseDailymotionInput } from '../../src/server/providers/dailymotion/ids.ts';
import { dailymotionSource } from '../../src/server/providers/dailymotion/source.ts';
import { SourceError } from '../../src/server/providers/sources/types.ts';

let calls: string[] = [];
let respond: (url: string) => Response = () => new Response('', { status: 500 });

beforeEach(() => {
  calls = [];
  setDailymotionFetchForTests(async (url) => {
    calls.push(url);
    return respond(url);
  });
});
afterEach(() => setDailymotionFetchForTests());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const errorOf = async (promise: Promise<unknown>): Promise<SourceError> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SourceError) return err;
    throw err;
  }
  throw new Error('esperava um SourceError');
};

describe('parseDailymotionInput', () => {
  test('nome, link do canal e link de playlist', () => {
    expect(parseDailymotionInput('Canal_1')).toEqual({ kind: 'user', id: 'Canal_1' });
    expect(parseDailymotionInput('https://www.dailymotion.com/canal')).toEqual({ kind: 'user', id: 'canal' });
    expect(parseDailymotionInput('https://www.dailymotion.com/playlist/x6hczf')).toEqual({ kind: 'playlist', id: 'x6hczf' });
    expect(parseDailymotionInput('x6hczf')).toEqual({ kind: 'playlist', id: 'x6hczf' });
  });
  test('recusa host de fora, http, porta, rotas reservadas e lixo', () => {
    for (const bad of ['http://dailymotion.com/canal', 'https://evil.com/canal', 'https://dailymotion.com:8443/canal', 'https://dailymotion.com/video/x1abc', 'a/b', '', 'video']) {
      expect(parseDailymotionInput(bad)).toBeNull();
    }
  });
  test('handle do banco é revalidado', () => {
    expect(parseDailymotionHandle('dailymotion:user:canal')).toEqual({ kind: 'user', id: 'canal' });
    expect(parseDailymotionHandle('dailymotion:playlist:../x')).toBeNull();
    expect(parseDailymotionHandle('youtube:user:canal')).toBeNull();
  });
});

describe('source', () => {
  test('resolve usa screenname como nome', async () => {
    respond = () => json({ screenname: 'Meu Canal' });
    expect(await dailymotionSource.resolve('meucanal')).toEqual({ handle: 'dailymotion:user:meucanal', name: 'Meu Canal' });
    expect(calls[0]).toBe('https://api.dailymotion.com/user/meucanal?fields=screenname');
  });

  test('404 vira erro nosso', async () => {
    respond = () => json({}, 404);
    expect((await errorOf(dailymotionSource.resolve('naoexiste'))).status).toBe(404);
  });

  test('list pagina, descarta ids ruins e só aceita miniatura do CDN', async () => {
    respond = (url) =>
      url.includes('page=1')
        ? json({
            has_more: true,
            list: [
              { id: 'x8abc12', title: ' Um ', duration: 61.4, created_time: 1_700_000_000, thumbnail_480_url: 'https://s1.dmcdn.net/v/a.jpg' },
              { id: '../evil', title: 'ruim' },
              { id: 'x8abc13', title: '', thumbnail_480_url: 'https://evil.com/a.jpg' },
            ],
          })
        : json({ has_more: false, list: [{ id: 'x8abc14', title: 'Três', created_time: 1_600_000_000 }] });
    const items = await dailymotionSource.list('dailymotion:user:meucanal');
    expect(items.map((i) => i.fileRef)).toEqual(['x8abc12', 'x8abc13', 'x8abc14']);
    expect(items[0]).toMatchObject({ caption: 'Um', durationSeconds: 61, thumbnailUrl: 'https://s1.dmcdn.net/v/a.jpg' });
    expect(items[1]).toMatchObject({ caption: 'Vídeo sem título', thumbnailUrl: null });
    expect(calls).toHaveLength(2);
  });

  test('corpo inesperado e handle inválido', async () => {
    respond = () => json({ nada: true });
    expect((await errorOf(dailymotionSource.list('dailymotion:user:canal'))).status).toBe(502);
    expect((await errorOf(dailymotionSource.list('lixo'))).status).toBe(400);
  });

  test('embed só para id válido; play dá 501; thumb recusa host de fora', async () => {
    expect(dailymotionSource.embedUrl?.('x8abc12')).toBe('https://www.dailymotion.com/embed/video/x8abc12');
    expect(dailymotionSource.embedUrl?.('x/../y')).toBeNull();
    expect((await errorOf(dailymotionSource.play({ handle: 'h', fileRef: 'x8abc12', range: undefined }))).status).toBe(501);
    expect(await dailymotionSource.thumb?.({ handle: 'h', fileRef: 'x8abc12', thumbnailUrl: 'https://evil.com/a.jpg' })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
