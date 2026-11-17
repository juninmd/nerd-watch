import { config } from '../config/config.ts';
import { updateEnvVar } from '../config/env-file.ts';
import { disconnectDrive } from '../providers/drive/oauth.ts';
import { startTelegramBotPoller, stopTelegramBotPoller } from '../telegram/bot-poller.ts';
import { parseHttpUrl } from '../notify/url.ts';

/** Valor atual de uma credencial no config em memória (`undefined` = não configurada). Nunca vai para log nem resposta crua. */
export const readCredential = (key: string): string | undefined => {
  switch (key) {
    case 'TMDB_API_KEY': return config.tmdb.apiKey;
    case 'OPENSUBTITLES_API_KEY': return config.opensubtitles.apiKey;
    case 'TELEGRAM_BOT_TOKEN': return config.telegram.botToken;
    case 'TELEGRAM_API_ID': return config.telegram.apiId === undefined ? undefined : String(config.telegram.apiId);
    case 'TELEGRAM_API_HASH': return config.telegram.apiHash;
    case 'GOOGLE_CLIENT_ID': return config.drive.clientId;
    case 'GOOGLE_CLIENT_SECRET': return config.drive.clientSecret;
    case 'NOTIFY_DISCORD_WEBHOOK_URL': return config.notify.discordUrl;
    case 'NOTIFY_NTFY_URL': return config.notify.ntfyUrl;
    case 'NOTIFY_WEBHOOK_URL': return config.notify.webhookUrl;
    case 'NOTIFY_TELEGRAM_BOT_TOKEN': return config.notify.telegramBotToken;
    case 'NOTIFY_TELEGRAM_CHAT_ID': return config.notify.telegramChatId;
    default: return undefined;
  }
};

const assign = async (key: string, value: string | undefined): Promise<void> => {
  switch (key) {
    case 'TMDB_API_KEY': config.tmdb.apiKey = value; break;
    case 'OPENSUBTITLES_API_KEY': config.opensubtitles.apiKey = value; break;
    case 'TELEGRAM_BOT_TOKEN':
      config.telegram.botToken = value;
      if (value) startTelegramBotPoller();
      else stopTelegramBotPoller();
      break;
    case 'TELEGRAM_API_ID': config.telegram.apiId = value === undefined ? undefined : Number(value); break;
    case 'TELEGRAM_API_HASH': config.telegram.apiHash = value; break;
    case 'GOOGLE_CLIENT_ID':
      // O refresh token pertence ao client que o emitiu: outro client ID o invalida (mesma regra de routes/drive.ts).
      if (value !== config.drive.clientId && config.drive.refreshToken) await disconnectDrive();
      config.drive.clientId = value;
      break;
    case 'GOOGLE_CLIENT_SECRET': config.drive.clientSecret = value; break;
    case 'NOTIFY_DISCORD_WEBHOOK_URL': config.notify.discordUrl = parseHttpUrl(value); break;
    case 'NOTIFY_NTFY_URL': config.notify.ntfyUrl = parseHttpUrl(value); break;
    case 'NOTIFY_WEBHOOK_URL': config.notify.webhookUrl = parseHttpUrl(value); break;
    case 'NOTIFY_TELEGRAM_BOT_TOKEN': config.notify.telegramBotToken = value; break;
    case 'NOTIFY_TELEGRAM_CHAT_ID': config.notify.telegramChatId = value; break;
  }
};

/** Grava no `.env` (0600) e aplica no config em memória. `undefined` limpa. O valor nunca é logado. */
export const saveCredential = async (key: string, value: string | undefined, envPath?: string): Promise<void> => {
  updateEnvVar(key, value ?? '', envPath);
  await assign(key, value);
};
