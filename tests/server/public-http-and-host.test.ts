import { describe, expect, test } from 'bun:test';
import { fetchCapped } from '../../src/server/providers/public-http.ts';
import { checkResolvedHost } from '../../src/server/subtitles/load.ts';

describe('fetchCapped — cancela corpo fora de 2xx', () => {
  test('cancela o stream imediatamente em 302 e 500 sem ler o corpo', async () => {
    for (const status of [302, 500]) {
      let cancelled = false;
      const res = await fetchCapped(
        async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { status, headers: { location: 'https://example.com/next' } },
          ),
        'https://example.com/start',
        {},
        5000,
        1024,
      );
      expect(res.status).toBe(status);
      expect(cancelled).toBe(true);
    }
  });
});

describe('checkResolvedHost — falha fechada em IP literal e URL inválida', () => {
  test('recusa IPs privados/loopback literais mesmo chamado isoladamente', async () => {
    expect(await checkResolvedHost('http://127.0.0.1/a')).toBe('private');
    expect(await checkResolvedHost('http://169.254.169.254/latest')).toBe('private');
    expect(await checkResolvedHost('http://[::1]/a')).toBe('private');
    expect(await checkResolvedHost('https://93.184.216.34/a')).toBe('public');
    expect(await checkResolvedHost('nao-e-url')).toBe('unresolved');
  });
});
