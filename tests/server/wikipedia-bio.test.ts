import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { pickBio, resetWikipediaRateLimitForTests, wikipediaBio } from '../../src/server/providers/wikipedia-bio.ts';

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (extract: string, url = 'https://en.wikipedia.org/wiki/Patton_Oswalt', type = 'standard') => ({ type, extract, content_urls: { desktop: { page: url } } });

beforeEach(() => resetWikipediaRateLimitForTests());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('pickBio', () => {
  test('aceita artigo comum que fala de trabalho de tela', () => {
    expect(pickBio(page('Patton Oswalt is an American stand-up comedian and actor.'), 'en')).toEqual({
      extract: 'Patton Oswalt is an American stand-up comedian and actor.',
      url: 'https://en.wikipedia.org/wiki/Patton_Oswalt',
      lang: 'en',
    });
  });

  test('recusa homônimo sem profissão de tela, desambiguação e link fora da Wikipédia', () => {
    expect(pickBio(page('Victor Williams was a 19th-century British bishop.'), 'en')).toBeNull();
    // Escritor ou músico homônimo não passa: só profissões de tela, com palavra inteira ("hosted" não é "host").
    expect(pickBio(page('Kevin James is a British novelist and writer who hosted a radio prize.'), 'en')).toBeNull();
    expect(pickBio(page('Leah Remini é uma atriz norte-americana.'), 'pt')).not.toBeNull();
    expect(pickBio(page('Victor Williams may refer to an actor or a bishop.', undefined, 'disambiguation'), 'en')).toBeNull();
    expect(pickBio(page('An American actor.', 'https://evil.example.test/wiki/x'), 'en')).toBeNull();
    expect(pickBio(page('An American actor.', 'javascript:alert(1)'), 'en')).toBeNull();
    expect(pickBio(null, 'en')).toBeNull();
  });

  test('codifica parênteses do link e corta texto longo numa palavra (ou no teto sem espaço)', () => {
    const bio = pickBio(page(`Victor Williams is an American actor. ${'word '.repeat(400)}`, 'https://en.wikipedia.org/wiki/Victor_Williams_(actor)'), 'en');
    expect(bio?.url).toBe('https://en.wikipedia.org/wiki/Victor_Williams_%28actor%29');
    expect(bio?.extract.length).toBeLessThanOrEqual(901);
    expect(bio?.extract.endsWith('…')).toBe(true);

    const noSpace = pickBio(page(`actor-${'a'.repeat(1200)}`), 'en');
    expect(noSpace?.extract.length).toBe(901);
    expect(noSpace?.extract.endsWith('…')).toBe(true);

    expect(pickBio(page('An American actor.', 'https://user@en.wikipedia.org/wiki/X'), 'en')).toBeNull();
    expect(pickBio(page('An American actor.', 'https://en.wikipedia.org:8443/wiki/X'), 'en')).toBeNull();
  });
});

describe('wikipediaBio', () => {
  test('tenta pt e cai para en quando não acha em português', async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(new URL(url).host);
      return url.includes('pt.wikipedia') ? json({}, 404) : json(page('Leah Remini is an American actress.', 'https://en.wikipedia.org/wiki/Leah_Remini'));
    }) as unknown as typeof fetch;
    const bio = await wikipediaBio('Leah Remini');
    expect(bio?.lang).toBe('en');
    expect(asked).toEqual(['pt.wikipedia.org', 'en.wikipedia.org']);
  });

  test('nome inválido nem chega a consultar', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;
    expect(await wikipediaBio('a\u0000b')).toBeNull();
    expect(await wikipediaBio('x'.repeat(200))).toBeNull();
    expect(called).toBe(false);
  });
});
