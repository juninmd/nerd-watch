interface TelegramRuntimeConfig {
  botToken?: string;
  apiId?: number;
  apiHash?: string;
  session?: string;
}

/**
 * Ao contrário do resto do config (fixo no boot), os campos do Telegram podem ser configurados pela
 * própria UI em runtime (ver `routes/telegram-settings.ts`) — por isso ficam num objeto mutável separado,
 * em vez de dentro do `as const` abaixo.
 */
const telegram: TelegramRuntimeConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
  apiId: process.env.TELEGRAM_API_ID?.trim() ? Number(process.env.TELEGRAM_API_ID.trim()) : undefined,
  apiHash: process.env.TELEGRAM_API_HASH?.trim() || undefined,
  session: process.env.TELEGRAM_SESSION?.trim() || undefined,
};

/**
 * Sem esta validação um `TORRENT_MAX_ACTIVE=abc` viraria `NaN`, e `handles.size >= NaN` é sempre
 * falso — ou seja, o teto de torrents abertos silenciosamente deixaria de existir.
 */
const numberEnv = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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
  /**
   * Engine de torrent P2P. Escopo deliberadamente restrito ao acervo de domínio público da
   * Internet Archive (ver `torrent/engine.ts`): o app monta a URL do .torrent a partir do
   * `identifier` do item, nunca aceita magnet/.torrent arbitrário — assim ele não vira um
   * player de catálogo comercial.
   */
  torrent: {
    enabled: process.env.TORRENT_ENABLED !== 'false',
    downloadPath: process.env.TORRENT_PATH ?? '.cache/torrents',
    /** Teto de conexões por torrent — segura o consumo de sockets num app local. */
    maxConnections: numberEnv(process.env.TORRENT_MAX_CONNECTIONS, 55),
    /**
     * Teto de upload em KB/s. NÃO use 0: no webtorrent `uploadLimit: 0` significa throttle de
     * zero byte/s (bloqueia upload e faz os peers nos chocarem), enquanto `-1` é que é "sem
     * limite". Um teto modesto evita saturar o upload da sua conexão enquanto você assiste.
     */
    uploadLimitKbps: numberEnv(process.env.TORRENT_UPLOAD_LIMIT_KB, 100),
    /** Quantos torrents podem ficar abertos ao mesmo tempo (LRU eviction acima disso). */
    maxActive: numberEnv(process.env.TORRENT_MAX_ACTIVE, 3),
    /** Sem nenhuma leitura por esse tempo, o torrent é destruído e o disco liberado. */
    idleMs: numberEnv(process.env.TORRENT_IDLE_MINUTES, 10) * 60_000,
    /** Quanto esperar a metadata do torrent antes de desistir. */
    metadataTimeoutMs: numberEnv(process.env.TORRENT_METADATA_TIMEOUT_SECONDS, 45) * 1000,
  },
  telegram,
} as const;

export const tmdbEnabled = (): boolean => Boolean(config.tmdb.apiKey);
export const openSubtitlesEnabled = (): boolean => Boolean(config.opensubtitles.apiKey);
export const torrentEnabled = (): boolean => config.torrent.enabled;
export const telegramBotEnabled = (): boolean => Boolean(config.telegram.botToken);
export const telegramPersonalEnabled = (): boolean =>
  Boolean(config.telegram.apiId && config.telegram.apiHash && config.telegram.session);
