import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../../src/server/config/config.ts';
import { OpenSubtitlesRequestError, requestSubtitleDownload } from '../../src/server/providers/opensubtitles.ts';
import { TmdbRequestError, tmdbImageUrl, tmdbTitleDetails } from '../../src/server/providers/tmdb.ts';

const origFetch = globalThis.fetch;
const origTmdbKey = config.tmdb.apiKey;
const origOsKey = config.opensubtitles.apiKey;

afterEach(() => {
  globalThis.fetch = origFetch;
  config.tmdb.apiKey = origTmdbKey;
  config.opensubtitles.apiKey = origOsKey;
});

describe('tmdbImageUrl', () => {
  test('aceita caminho relativo padrão da TMDB e rejeita traversal ou URL arbitrária', () => {
    expect(tmdbImageUrl('/abc123_XYZ.jpg', 'w342')).toBe('https://image.tmdb.org/t/p/w342/abc123_XYZ.jpg');
    expect(tmdbImageUrl('/../secret.jpg')).toBeNull();
    expect(tmdbImageUrl('https://evil.example/x.jpg')).toBeNull();
    expect(tmdbImageUrl('/a/b.jpg')).toBeNull();
    expect(tmdbImageUrl(null)).toBeNull();
  });
});

describe('TMDB e OpenSubtitles — redirect: error e falha de rede vira erro tipado 502', () => {
  test('TMDB usa redirect: error e mapeia erro de rede para TmdbRequestError(502)', async () => {
    config.tmdb.apiKey = 'test-key';
    let seenRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenRedirect = init?.redirect;
      throw new TypeError('network error');
    }) as unknown as typeof fetch;

    await expect(tmdbTitleDetails('movie', 990001)).rejects.toMatchObject({
      name: 'TmdbRequestError',
      status: 502,
    });
    expect(seenRedirect).toBe('error');
  });

  test('OpenSubtitles usa redirect: error e mapeia erro de rede para OpenSubtitlesRequestError(502)', async () => {
    config.opensubtitles.apiKey = 'test-os-key';
    let seenRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenRedirect = init?.redirect;
      throw new TypeError('timeout');
    }) as unknown as typeof fetch;

    await expect(requestSubtitleDownload(42)).rejects.toBeInstanceOf(OpenSubtitlesRequestError);
    expect(seenRedirect).toBe('error');
  });

  test('TmdbRequestError preserva status HTTP e cancela corpo de erro', async () => {
    config.tmdb.apiKey = 'test-key';
    let cancelled = false;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 404 },
      )) as unknown as typeof fetch;

    await expect(tmdbTitleDetails('movie', 990002)).rejects.toBeInstanceOf(TmdbRequestError);
    expect(cancelled).toBe(true);
  });
});
