export const config = {
  port: Number(process.env.PORT ?? 7799),
  dbPath: process.env.DB_PATH ?? 'data/nerd-watch.db',
  tmdb: {
    apiKey: process.env.TMDB_API_KEY?.trim() || undefined,
    language: process.env.TMDB_LANGUAGE?.trim() || 'pt-BR',
    region: process.env.TMDB_REGION?.trim() || 'BR',
  },
  opensubtitles: {
    apiKey: process.env.OPENSUBTITLES_API_KEY?.trim() || undefined,
    languages: process.env.OPENSUBTITLES_LANGUAGES?.trim() || 'pt-BR,pt,en',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    apiId: process.env.TELEGRAM_API_ID?.trim() ? Number(process.env.TELEGRAM_API_ID.trim()) : undefined,
    apiHash: process.env.TELEGRAM_API_HASH?.trim() || undefined,
    session: process.env.TELEGRAM_SESSION?.trim() || undefined,
  },
} as const;

export const tmdbEnabled = (): boolean => Boolean(config.tmdb.apiKey);
export const openSubtitlesEnabled = (): boolean => Boolean(config.opensubtitles.apiKey);
export const telegramBotEnabled = (): boolean => Boolean(config.telegram.botToken);
export const telegramPersonalEnabled = (): boolean =>
  Boolean(config.telegram.apiId && config.telegram.apiHash && config.telegram.session);
