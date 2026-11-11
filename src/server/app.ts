import { Hono } from 'hono';
import { config, openSubtitlesEnabled, telegramBotEnabled, tmdbEnabled, torrentEnabled } from './config/config.ts';
import { createAccess } from './http/access-guard.ts';
import { originAllowed, requestAllowed } from './http/security.ts';
import { createStaticHandler } from './http/static.ts';
import { searchRoutes } from './routes/search.ts';
import { tmdbRoutes } from './routes/tmdb.ts';
import { archiveRoutes } from './routes/archive.ts';
import { tvmazeRoutes } from './routes/tvmaze.ts';
import { anilistRoutes } from './routes/anilist.ts';
import { libraryRoutes } from './routes/library.ts';
import { libraryIoRoutes } from './routes/library-io.ts';
import { libraryRefreshRoutes } from './routes/library-refresh.ts';
import { listsRoutes } from './routes/lists.ts';
import { savedViewsRoutes } from './routes/saved-views.ts';
import { statsRoutes } from './routes/stats.ts';
import { calendarIcsRoutes, calendarRoutes } from './routes/calendar.ts';
import { subtitlesRoutes } from './routes/subtitles.ts';
import { torrentRoutes } from './routes/torrent.ts';
import { backupRoutes } from './routes/backup.ts';
import { telegramRoutes } from './routes/telegram.ts';
import { telegramSettingsRoutes } from './routes/telegram-settings.ts';
import { driveRoutes } from './routes/drive.ts';
import { sourcesRoutes } from './routes/sources.ts';
import { playbackRoutes } from './routes/playback.ts';
import { traktRoutes } from './routes/trakt.ts';
import { createMediaRoutes } from './routes/media.ts';
import { createMediaService } from './media/service.ts';
import { localLocator } from './media/local-locator.ts';
import { mediaSettings } from './media/settings.ts';

/**
 * Aplicação Hono, sem nada de processo: quem decide como ela é servida é o entrypoint.
 *
 * - `src/server/index.ts` expõe em HTTP (dev, Docker, acesso remoto).
 * - `src/server/worker.ts` chama `app.fetch` a partir do shell Tauri, sem porta para o cliente.
 */
const app = new Hono();
const remoteAccess = config.access.token !== undefined;

app.use('*', async (c, next) => {
  const host = c.req.header('Host') ?? '';
  const origin = c.req.header('Origin') ?? '';
  if (!requestAllowed(c.req.method, host, origin, remoteAccess)) return c.text('requisição não permitida', 403);
  if (c.req.method === 'OPTIONS' && originAllowed(origin, host)) {
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

if (config.access.token !== undefined) {
  const access = createAccess({ token: config.access.token, trustProxy: config.access.trustProxy });
  app.use('*', access.guard);
  app.route('/', access.routes);
}

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    tmdbEnabled: tmdbEnabled(),
    openSubtitlesEnabled: openSubtitlesEnabled(),
    torrentEnabled: torrentEnabled(),
    telegramBotEnabled: telegramBotEnabled(),
  }),
);
app.route('/api/search', searchRoutes);
app.route('/api/tmdb', tmdbRoutes);
app.route('/api/archive', archiveRoutes);
app.route('/api/tvmaze', tvmazeRoutes);
app.route('/api/anilist', anilistRoutes);
app.route('/api/library', libraryRoutes);
app.route('/api/library', libraryIoRoutes);
app.route('/api/library', libraryRefreshRoutes);
app.route('/api/lists', listsRoutes);
app.route('/api/views', savedViewsRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api', calendarIcsRoutes);
app.route('/api/subtitles', subtitlesRoutes);
app.route('/api/torrent', torrentRoutes);
app.route('/api/backup', backupRoutes);
app.route('/api/telegram', telegramRoutes);
app.route('/api/telegram/settings', telegramSettingsRoutes);
app.route('/api/drive', driveRoutes);
app.route('/api/sources', sourcesRoutes);
app.route('/api/playback', playbackRoutes);
app.route('/api/trakt', traktRoutes);

// Conversão de formatos (ffmpeg opcional): sem o binário, nada muda e a UI explica o motivo.
const mediaCfg = mediaSettings();
app.route('/api/media', createMediaRoutes(createMediaService({ settings: mediaCfg, locate: localLocator })));

// No app desktop o cliente vai embutido no Tauri, então este middleware só serve dev/Docker.
app.use('/*', createStaticHandler(process.env.PUBLIC_DIR ?? './public'));

export { app };
