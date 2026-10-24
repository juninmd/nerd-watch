import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { config, openSubtitlesEnabled, telegramBotEnabled, tmdbEnabled, torrentEnabled } from './config.ts';
import { startTelegramBotPoller } from './telegram-bot-poller.ts';
import { createAccess } from './access-guard.ts';
import { requestAllowed, originAllowed } from './security.ts';
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
import { startMetadataRefreshJob } from './metadata/refresh-service.ts';
import { statsRoutes } from './routes/stats.ts';
import { calendarIcsRoutes, calendarRoutes } from './routes/calendar.ts';
import { subtitlesRoutes } from './routes/subtitles.ts';
import { torrentRoutes } from './routes/torrent.ts';
import { backupRoutes } from './routes/backup.ts';
import { telegramRoutes } from './routes/telegram.ts';
import { telegramSettingsRoutes } from './routes/telegram-settings.ts';
import { registerAllSources } from './providers/sources/index.ts';
import { driveRoutes } from './routes/drive.ts';
import { sourcesRoutes } from './routes/sources.ts';
import { playbackRoutes } from './routes/playback.ts';
import { traktRoutes } from './routes/trakt.ts';
import { createMediaRoutes } from './routes/media.ts';
import { cleanupMediaCache, createMediaService } from './media/service.ts';
import { localLocator } from './media/local-locator.ts';
import { installShutdownHandlers } from './media/process.ts';
import { mediaSettings } from './media/settings.ts';
import { binaryStatus } from './media/binaries.ts';
import { startTorrentSweeper } from './torrent/engine.ts';
import { getDb } from './db.ts';
import { buildSinks } from './notify/sinks.ts';
import { startNotifyScheduler } from './notify/scheduler.ts';

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
        'Access-Control-Max-Age': 86400,
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
app.route('/api/stats', statsRoutes);

// Conversão de formatos (ffmpeg opcional): sem o binário, nada muda e a UI explica o motivo.
const mediaCfg = mediaSettings();
app.route('/api/media', createMediaRoutes(createMediaService({ settings: mediaCfg, locate: localLocator })));

app.use('/*', serveStatic({ root: './public' }));

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
  // O padrão do Bun (10s) derruba o streaming de torrent antes do primeiro pedaço chegar de um peer lento.
  idleTimeout: 255,
};

registerAllSources();
startTelegramBotPoller();
startTorrentSweeper();
startMetadataRefreshJob();
installShutdownHandlers();
void cleanupMediaCache(mediaCfg);

// Sem ACCESS_TOKEN a saída de boot não muda. Com ele, avisa que o HTTPS é responsabilidade do proxy.
if (remoteAccess) console.log('acesso remoto ativo (ACCESS_TOKEN): exponha só por HTTPS, via proxy reverso (ver README)');
// Avisos de lançamento: só sobe com um destino configurado por env (nunca por request).
const notifySinks = buildSinks({ webhookUrl: config.notify.webhookUrl, ntfyUrl: config.notify.ntfyUrl });
if (notifySinks.length > 0) {
  void getDb()
    .then((db) =>
      startNotifyScheduler({
        db,
        sinks: notifySinks,
        leadDays: config.notify.leadDays,
        now: () => new Date(),
        log: (line) => console.warn(line),
      }),
    )
    .catch((err: unknown) => console.warn('[notify] agendador não subiu:', err instanceof Error ? err.name : 'erro'));
}

console.log(
  `nerd-watch em http://127.0.0.1:${config.port} (TMDB ${tmdbEnabled() ? 'ativo' : 'sem chave — só domínio público'}, ` +
    `legendas ${openSubtitlesEnabled() ? 'com chave OpenSubtitles' : 'via addons do Stremio (sem chave)'}, ` +
    `torrent ${torrentEnabled() ? 'ativo' : 'desligado'}, ` +
    `bot do Telegram ${telegramBotEnabled() ? 'ativo' : 'desligado — sem TELEGRAM_BOT_TOKEN'}, ` +
    `avisos de lançamento ${notifySinks.length > 0 ? notifySinks.map((s) => s.name).join(' + ') : 'desligados'}, ` +
    `conversão ${binaryStatus(mediaCfg).ok ? 'com ffmpeg' : 'desligada'})`,
);
