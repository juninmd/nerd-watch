import { config } from './config/config.ts';
import { startTelegramBotPoller } from './telegram/bot-poller.ts';
import { registerAllSources } from './providers/sources/index.ts';
import { startMetadataRefreshJob } from './metadata/refresh-service.ts';
import { installShutdownHandlers } from './media/process.ts';
import { cleanupMediaCache } from './media/service.ts';
import { mediaSettings } from './media/settings.ts';
import { startTorrentSweeper } from './torrent/engine.ts';
import { getDb } from './db/database.ts';
import { buildSinks } from './notify/sinks.ts';
import { startNotifyScheduler } from './notify/scheduler.ts';

/**
 * Trabalho de fundo que precisa existir em qualquer modo: HTTP (`index.ts`) e worker do desktop
 * (`worker.ts`). Sem isso o app responde, mas não atualiza metadados, torrents, bot e avisos.
 */
export const startBackgroundJobs = (): void => {
  registerAllSources();
  startTelegramBotPoller();
  startTorrentSweeper();
  startMetadataRefreshJob();
  installShutdownHandlers();
  void cleanupMediaCache(mediaSettings());

  // Avisos de lançamento: só sobe com um destino configurado por env (nunca por request).
  const notifySinks = buildSinks({ webhookUrl: config.notify.webhookUrl, ntfyUrl: config.notify.ntfyUrl });
  if (notifySinks.length === 0) return;
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
};
