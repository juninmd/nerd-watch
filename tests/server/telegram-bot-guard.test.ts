import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../../src/server/config/config.ts';
import { resolveBotFileUrl } from '../../src/server/providers/telegram/bot.ts';

const origFetch = globalThis.fetch;
const origToken = config.telegram.botToken;

afterEach(() => {
  globalThis.fetch = origFetch;
  config.telegram.botToken = origToken;
});

describe('Telegram Bot API (redirect e file_path)', () => {
  test('usa redirect: error e aceita file_path normal', async () => {
    config.telegram.botToken = '123456:TEST_TOKEN';
    let seenRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenRedirect = init?.redirect;
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'videos/file_1.mp4', file_size: 1024 } }));
    }) as unknown as typeof fetch;

    const out = await resolveBotFileUrl('file_1');
    expect(seenRedirect).toBe('error');
    expect(out).toEqual({ ok: true, url: 'https://api.telegram.org/file/bot123456:TEST_TOKEN/videos/file_1.mp4' });
  });

  test('descarta file_path com traversal ou prefixo absoluto', async () => {
    config.telegram.botToken = '123456:TEST_TOKEN';
    for (const bad of ['../secret', '/etc/passwd', 'videos/a?x=1']) {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ ok: true, result: { file_path: bad, file_size: 100 } }))) as unknown as typeof fetch;
      expect(await resolveBotFileUrl('file_bad')).toEqual({ ok: false, reason: 'not_found' });
    }
  });
});
