import { cachedProbe, probeSources } from './health/probe.ts';
import pkg from '../../package.json' with { type: 'json' };
import { Hono } from 'hono';
import { config, openSubtitlesEnabled, telegramBotEnabled, tmdbEnabled, torrentEnabled } from './config/config.ts';
import { createAccess } from './http/access-guard.ts';
import { buildSinks } from './notify/sinks.ts';
import { APP_CSP, HARDENING_HEADERS, originAllowed, requestAllowed } from './http/security.ts';
import { createStaticHandler } from './http/static.ts';
import { searchRoutes } from './routes/search.ts';
import { tmdbRoutes } from './routes/tmdb.ts';
import { archiveRoutes } from './routes/archive.ts';
import { tvmazeRoutes } from './routes/tvmaze.ts';
import { anilistRoutes } from './routes/anilist.ts';
import { libraryRoutes } from './routes/library.ts';
import { libraryRelinkRoutes } from './routes/library-relink.ts';
import { skipTimesRoutes } from './routes/skip-times.ts';
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
import { credentialsRoutes } from './routes/credentials.ts';
import { sourcesRoutes } from './routes/sources.ts';
import { playbackRoutes } from './routes/playback.ts';
import { traktRoutes } from './routes/trakt.ts';
import { commonsRoutes } from './routes/commons.ts';
import { stremioRoutes } from './routes/stremio.ts';
import { createMediaRoutes } from './routes/media.ts';
import { createMediaService } from './media/service.ts';
import { localLocator } from './media/local-locator.ts';
import { mediaSettings } from './media/settings.ts';
import { createCastRoutes } from './routes/cast.ts';
import { createCastService } from './cast/service.ts';
import { createCastRelay } from './cast/relay.ts';
import { createDlnaClient } from './cast/dlna-client.ts';
import { listLanInterfaces } from './cast/network.ts';

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
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  try {
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
      if (!c.res.headers.has(name)) c.res.headers.set(name, value);
    }
    if (c.res.headers.get('Content-Type')?.startsWith('text/html') && !c.res.headers.has('Content-Security-Policy')) {
      c.res.headers.set('Content-Security-Policy', APP_CSP);
    }
  } catch {
    // Response vinda de fetch tem cabeçalhos imutáveis: segue sem o endurecimento extra.
  }
});

if (config.access.token !== undefined) {
  const access = createAccess({ token: config.access.token, trustProxy: config.access.trustProxy });
  app.use('*', access.guard);
  app.route('/', access.routes);
}

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    // Versão do servidor: no navegador/Docker não há `getVersion()` do Tauri, então a UI lê daqui.
    version: pkg.version,
    tmdbEnabled: tmdbEnabled(),
    openSubtitlesEnabled: openSubtitlesEnabled(),
    torrentEnabled: torrentEnabled(),
    telegramBotEnabled: telegramBotEnabled(),
    // Só indicadores: as URLs e o token nunca saem do servidor. A tela Ajustes usa isto para mostrar o estado.
    notifyEnabled: buildSinks(config.notify).length > 0,
    notifyLeadDays: config.notify.leadDays,
    accessEnabled: Boolean(config.access.token),
  }),
);
// Latência das fontes públicas: atrás do guard de acesso (só `/api/health` exato é público) e com cache de 60 s.
const sourceHealth = cachedProbe(() => probeSources());
app.get('/api/health/sources', async (c) => c.json({ sources: await sourceHealth() }));
app.route('/api/search', searchRoutes);
app.route('/api/tmdb', tmdbRoutes);
app.route('/api/archive', archiveRoutes);
app.route('/api/tvmaze', tvmazeRoutes);
app.route('/api/anilist', anilistRoutes);
app.route('/api/library', libraryRoutes);
app.route('/api/library', libraryRelinkRoutes);
app.route('/api/skip-times', skipTimesRoutes);
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
app.route('/api/credentials', credentialsRoutes);
app.route('/api/sources', sourcesRoutes);
app.route('/api/playback', playbackRoutes);
app.route('/api/trakt', traktRoutes);
app.route('/api/stremio', stremioRoutes);
app.route('/api/commons', commonsRoutes);

// Conversão de formatos (ffmpeg opcional): sem o binário, nada muda e a UI explica o motivo.
const mediaCfg = mediaSettings();
app.route('/api/media', createMediaRoutes(createMediaService({ settings: mediaCfg, locate: localLocator })));

// Transmissão para a TV na rede local (DLNA/UPnP + link/QR sob demanda): só abre porta na LAN enquanto há sessão.
const castRelay = createCastRelay({
  port: config.cast.port,
  internalFetch: (req) => {
    const headers = new Headers(req.headers);
    headers.set('Host', `127.0.0.1:${config.port}`);
    if (config.access.token) headers.set('Authorization', `Bearer ${config.access.token}`);
    return app.fetch(new Request(req.url, { method: req.method, headers }));
  },
});
const castService = createCastService({
  relay: castRelay,
  dlna: createDlnaClient(),
  listInterfaces: () => listLanInterfaces(config.cast.host),
});
app.route('/api/cast', createCastRoutes(castService));

// No app desktop o cliente vai embutido no Tauri, então este middleware só serve dev/Docker.
app.use('/*', createStaticHandler(process.env.PUBLIC_DIR ?? './public'));

export { app };
