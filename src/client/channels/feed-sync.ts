import { listTelegramChannels, refreshTelegramChannel } from '../api/index.ts';
import { createRefreshGate } from '../app/refresh-gate.ts';

/** Intervalo mínimo entre leituras automáticas do Telegram: cada rodada consulta todos os canais. */
export const AUTO_SYNC_MIN_MS = 5 * 60_000;
/** Poucos canais por vez para não disparar o limite de requisições (flood wait) do Telegram. */
const CONCURRENCY = 3;

/** Um porteiro só, compartilhado entre início e canais: trocar de tela não dispara outra rodada. */
export const feedSyncGate = createRefreshGate(AUTO_SYNC_MIN_MS);

/** Pede ao servidor os vídeos novos de cada canal. Falha em um canal não derruba os outros. Devolve quantos falharam. */
export const syncAllChannels = async (): Promise<{ failed: number }> => {
  // Só canais do Telegram: as demais fontes (pasta, torrent, nuvem) têm custo próprio e ficam no botão do canal.
  const channels = (await listTelegramChannels()).channels.filter((c) => c.mode === 'public' || c.mode === 'personal');
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < channels.length) {
      const channel = channels[next++];
      if (!channel) return;
      await refreshTelegramChannel(channel.titleId).catch(() => {
        failed++;
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, channels.length) }, worker));
  return { failed };
};
