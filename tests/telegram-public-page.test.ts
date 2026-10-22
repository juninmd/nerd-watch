import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fetchPublicChannelPage, oldestPostId } from '../src/server/providers/telegram/public.ts';

const FIXTURE = readFileSync(`${import.meta.dir}/fixtures/telegram-public-channel.html`, 'utf-8');
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const captureUrls = (html = FIXTURE): string[] => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: URL | string) => {
    urls.push(String(url));
    return new Response(html);
  }) as unknown as typeof fetch;
  return urls;
};

describe('oldestPostId', () => {
  test('é o menor id entre TODOS os posts do canal, com vídeo ou não', () => {
    expect(oldestPostId(FIXTURE, 'canalteste')).toBe('100');
  });

  test('ignora posts de outro canal (encaminhados/embutidos) e o caso de maiúsculas', () => {
    const html = '<div data-post="outro/5"></div><div data-post="CanalTeste/42"></div><div data-post="canalteste/77"></div>';
    expect(oldestPostId(html, 'canalteste')).toBe('42');
  });

  test('sem nenhum post: nulo', () => {
    expect(oldestPostId('<html></html>', 'canalteste')).toBeNull();
  });
});

describe('fetchPublicChannelPage — paginação e busca', () => {
  test('`before` e `q` viram parâmetros da prévia; sem eles a URL fica como antes', async () => {
    const urls = captureUrls();
    await fetchPublicChannelPage('canalteste');
    await fetchPublicChannelPage('canalteste', { before: '100' });
    await fetchPublicChannelPage('canalteste', { query: 'dois nomes' });
    expect(urls[0]).toBe('https://t.me/s/canalteste');
    expect(new URL(urls[1] as string).searchParams.get('before')).toBe('100');
    expect(new URL(urls[2] as string).searchParams.get('q')).toBe('dois nomes');
  });

  test('devolve o id mais antigo da página para a próxima chamada continuar dali', async () => {
    captureUrls();
    expect((await fetchPublicChannelPage('canalteste')).oldestId).toBe('100');
  });
});
