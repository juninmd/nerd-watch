import { describe, expect, test } from 'bun:test';
import { torrentEnabled } from '../../src/server/config/config.ts';
import { libraryRoutes } from '../../src/server/routes/library.ts';
import { subtitlesRoutes } from '../../src/server/routes/subtitles.ts';
import { telegramHistoryRoutes } from '../../src/server/routes/telegram-history.ts';
import { telegramSettingsRoutes } from '../../src/server/routes/telegram-settings.ts';
import { telegramRoutes } from '../../src/server/routes/telegram.ts';
import { torrentRoutes } from '../../src/server/routes/torrent.ts';

const jsonReq = (body: string, method: 'POST' | 'PATCH' = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body,
});

describe('teto de corpo JSON nas rotas de library, telegram, torrent e subtitles', () => {
  const huge = JSON.stringify({ payload: 'x'.repeat(20 * 1024) });
  const hugeBulk = JSON.stringify({ payload: 'x'.repeat(70 * 1024) });

  test('rejeita corpo acima do teto com 413', async () => {
    expect((await telegramSettingsRoutes.request('/', jsonReq(huge))).status).toBe(413);
    expect((await telegramSettingsRoutes.request('/login/password', jsonReq(huge))).status).toBe(413);
    expect((await telegramHistoryRoutes.request('/ch1/search', jsonReq(huge))).status).toBe(413);
    expect((await telegramRoutes.request('/channels', jsonReq(huge))).status).toBe(413);
    expect((await telegramRoutes.request('/channels/bulk-delete', jsonReq(hugeBulk))).status).toBe(413);
    expect((await subtitlesRoutes.request('/download', jsonReq(huge))).status).toBe(413);
    expect((await libraryRoutes.request('/t1/progress', jsonReq(huge))).status).toBe(413);
    expect((await libraryRoutes.request('/t1', jsonReq(huge, 'PATCH'))).status).toBe(413);
    expect((await libraryRoutes.request('/bulk', jsonReq(hugeBulk))).status).toBe(413);
    if (torrentEnabled()) {
      expect((await torrentRoutes.request('/open', jsonReq(huge))).status).toBe(413);
    }
  });

  test('rejeita JSON que não é objeto com 400 e valida tipos de senha', async () => {
    expect((await telegramSettingsRoutes.request('/', jsonReq('[]'))).status).toBe(400);
    expect((await telegramSettingsRoutes.request('/login/password', jsonReq(JSON.stringify({ password: 123 })))).status).toBe(400);
    expect((await subtitlesRoutes.request('/download', jsonReq('"texto"'))).status).toBe(400);
    expect((await libraryRoutes.request('/t1', jsonReq('[]', 'PATCH'))).status).toBe(400);
  });
});
