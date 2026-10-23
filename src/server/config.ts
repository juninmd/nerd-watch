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

interface DriveRuntimeConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

/** Como o Telegram: configurado pela UI em runtime (ver `routes/drive.ts`), por isso fora do `as const`. */
const drive: DriveRuntimeConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID?.trim() || undefined,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() || undefined,
};

const GOOGLE = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  apiUrl: 'https://www.googleapis.com/drive/v3',
};

/**
 * Só para testes ponta a ponta com um Google falso. Aceita apenas loopback: um valor vindo do ambiente nunca
 * pode mandar o refresh token ou o código de autorização para um host externo.
 */
const driveEndpoints = (fake: string | undefined) => {
  if (!fake || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fake.trim())) return GOOGLE;
  const base = fake.trim();
  return { authUrl: `${base}/auth`, tokenUrl: `${base}/token`, revokeUrl: `${base}/revoke`, apiUrl: `${base}/drive/v3` };
};

/**
 * Sem esta validação um `TORRENT_MAX_ACTIVE=abc` viraria `NaN`, e `handles.size >= NaN` é sempre
 * falso — ou seja, o teto de torrents abertos silenciosamente deixaria de existir. O `min` existe
 * pelo mesmo motivo para `0` e negativos: `TORRENT_MAX_ACTIVE=0` também anula o teto, e
 * `TORRENT_UPLOAD_LIMIT_KB=0` bloquearia o upload de vez (ver o comentário daquela opção).
 */
const numberEnv = (raw: string | undefined, fallback: number, min: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

/**
 * `TORRENT_UPLOAD_LIMIT_KB` é o único que aceita negativo: `-1` é "sem limite" no webtorrent.
 * `0` NÃO é válido e precisa de guarda própria — ele passa por um `min` de -1, mas no webtorrent
 * significa throttle de zero byte/s, que bloqueia o upload e faz os peers nos chocarem (é
 * justamente o bug que a feature já teve uma vez).
 */
const uploadLimitEnv = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed === 0 || parsed < -1) return fallback;
  return parsed;
};

/**
 * Interface em que o servidor escuta. O padrão é loopback; só o container Docker define `0.0.0.0`, porque o
 * port mapping chega pela interface do container. A barreira de Host/Origin (`security.ts`) continua valendo.
 */
export const listenHost = (raw: string | undefined): string => raw?.trim() || '127.0.0.1';

export const config = {
  host: listenHost(process.env.HOST),
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
   * Busca de legendas. Duas fontes com naturezas diferentes: addons do protocolo do Stremio
   * (sem chave, devolvem a URL do arquivo) e a OpenSubtitles.com REST (com chave, com cota).
   */
  subtitles: {
    /** URLs-base de addons do Stremio que sirvam `subtitles`. Separadas por vírgula. */
    addons: (process.env.SUBTITLE_ADDONS?.trim() || 'https://opensubtitles-v3.strem.io')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    /** Idiomas aceitos, na ordem de preferência. */
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
    maxConnections: numberEnv(process.env.TORRENT_MAX_CONNECTIONS, 55, 1),
    /**
     * Teto de upload em KB/s: `-1` é sem limite, qualquer valor >= 1 é o teto. `0` cai no padrão
     * (ver `uploadLimitEnv`) — no webtorrent ele bloquearia o upload de vez.
     */
    uploadLimitKbps: uploadLimitEnv(process.env.TORRENT_UPLOAD_LIMIT_KB, 100),
    /** Quantos torrents podem ficar abertos ao mesmo tempo (LRU eviction acima disso). */
    maxActive: numberEnv(process.env.TORRENT_MAX_ACTIVE, 3, 1),
    /** Sem nenhuma leitura por esse tempo, o torrent é destruído e o disco liberado. */
    idleMs: numberEnv(process.env.TORRENT_IDLE_MINUTES, 10, 1) * 60_000,
    /** Quanto esperar a metadata do torrent antes de desistir. */
    metadataTimeoutMs: numberEnv(process.env.TORRENT_METADATA_TIMEOUT_SECONDS, 45, 1) * 1000,
  },
  telegram,
  drive,
  driveEndpoints: driveEndpoints(process.env.DRIVE_FAKE_BASE_URL),
} as const;

export const tmdbEnabled = (): boolean => Boolean(config.tmdb.apiKey);
export const openSubtitlesEnabled = (): boolean => Boolean(config.opensubtitles.apiKey);
export const torrentEnabled = (): boolean => config.torrent.enabled;
export const driveClientConfigured = (): boolean => Boolean(config.drive.clientId && config.drive.clientSecret);
export const driveConnected = (): boolean => driveClientConfigured() && Boolean(config.drive.refreshToken);
export const telegramBotEnabled = (): boolean => Boolean(config.telegram.botToken);
export const telegramPersonalEnabled = (): boolean =>
  Boolean(config.telegram.apiId && config.telegram.apiHash && config.telegram.session);
