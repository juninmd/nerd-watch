import { config } from './config/config.ts';
import { startTelegramBotPoller } from './telegram/bot-poller.ts';
import { registerAllSources } from './providers/sources/index.ts';
import { seedAddonsFromConfig } from './providers/stremio/seed.ts';
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
  void cleanupMediaCache(mediaSettings()).catch((err: unknown) =>
    console.warn('[media] limpeza de cache falhou:', err instanceof Error ? err.name : 'erro'),
  );

  // Addons configurados no ambiente: o link fica fora do repositório e a instalação manual continua valendo.
  void seedAddonsFromConfig(config.addons.manifestUrls)
    .then((added) => {
      if (added > 0) console.log(`addons: ${added} instalado(s) a partir do ambiente`);
    })
    .catch((err: unknown) => console.warn('[addons] semear do ambiente falhou:', err instanceof Error ? err.name : 'erro'));

  // Avisos de lançamento: só sobe com um destino configurado por env (nunca por request).
  const notifySinks = buildSinks({
    webhookUrl: config.notify.webhookUrl,
    ntfyUrl: config.notify.ntfyUrl,
    discordUrl: config.notify.discordUrl,
    telegramBotToken: config.notify.telegramBotToken,
    telegramChatId: config.notify.telegramChatId,
  });
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
