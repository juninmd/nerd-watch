import { app } from './app.ts';
import { startBackgroundJobs } from './bootstrap.ts';
import { config, openSubtitlesEnabled, telegramBotEnabled, tmdbEnabled, torrentEnabled } from './config/config.ts';
import { binaryStatus } from './media/binaries.ts';
import { mediaSettings } from './media/settings.ts';

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
  // O padrão do Bun (10s) derruba o streaming de torrent antes do primeiro pedaço chegar de um peer lento.
  idleTimeout: 255,
};

startBackgroundJobs();

// Sem ACCESS_TOKEN a saída de boot não muda. Com ele, avisa que o HTTPS é responsabilidade do proxy.
if (config.access.token !== undefined) {
  console.log('acesso remoto ativo (ACCESS_TOKEN): exponha só por HTTPS, via proxy reverso (ver README)');
}

console.log(
  `nerd-watch em http://127.0.0.1:${config.port} (TMDB ${tmdbEnabled() ? 'ativo' : 'sem chave — só domínio público'}, ` +
    `legendas ${openSubtitlesEnabled() ? 'com chave OpenSubtitles' : 'via addons do Stremio (sem chave)'}, ` +
    `torrent ${torrentEnabled() ? 'ativo' : 'desligado'}, ` +
    `bot do Telegram ${telegramBotEnabled() ? 'ativo' : 'desligado — sem TELEGRAM_BOT_TOKEN'}, ` +
    `conversão ${binaryStatus(mediaSettings()).ok ? 'com ffmpeg' : 'desligada'})`,
);
