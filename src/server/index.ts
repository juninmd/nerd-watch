import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config, openSubtitlesEnabled, telegramBotEnabled, tmdbEnabled } from './config.ts';
import { startTelegramBotPoller } from './telegram-bot-poller.ts';
import { requestAllowed, originAllowed } from './security.ts';
import { searchRoutes } from './routes/search.ts';
import { tmdbRoutes } from './routes/tmdb.ts';
import { archiveRoutes } from './routes/archive.ts';
import { libraryRoutes } from './routes/library.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { subtitlesRoutes } from './routes/subtitles.ts';
import { backupRoutes } from './routes/backup.ts';
import { telegramRoutes } from './routes/telegram.ts';
import { telegramSettingsRoutes } from './routes/telegram-settings.ts';

const app = new Hono();

app.use('*', async (c, next) => {
  const host = c.req.header('Host') ?? '';
  const origin = c.req.header('Origin') ?? '';
  if (!requestAllowed(c.req.method, host, origin)) return c.text('requisição não permitida', 403);
  if (c.req.method === 'OPTIONS' && originAllowed(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
});

app.get('/api/health', (c) =>
  c.json({ ok: true, tmdbEnabled: tmdbEnabled(), openSubtitlesEnabled: openSubtitlesEnabled(), telegramBotEnabled: telegramBotEnabled() }),
);
app.route('/api/search', searchRoutes);
app.route('/api/tmdb', tmdbRoutes);
app.route('/api/archive', archiveRoutes);
app.route('/api/library', libraryRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/subtitles', subtitlesRoutes);
app.route('/api/backup', backupRoutes);
app.route('/api/telegram', telegramRoutes);
app.route('/api/telegram/settings', telegramSettingsRoutes);

app.use('/*', serveStatic({ root: './public' }));

export default {
  port: config.port,
  hostname: '127.0.0.1',
  fetch: app.fetch,
};

startTelegramBotPoller();

console.log(
  `nerd-watch em http://127.0.0.1:${config.port} (TMDB ${tmdbEnabled() ? 'ativo' : 'sem chave — só domínio público'}, ` +
    `legendas ${openSubtitlesEnabled() ? 'ativas' : 'desligadas — sem OPENSUBTITLES_API_KEY'}, ` +
    `bot do Telegram ${telegramBotEnabled() ? 'ativo' : 'desligado — sem TELEGRAM_BOT_TOKEN'})`,
);
