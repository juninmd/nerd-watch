import { parseAccessToken } from '../http/access.ts';
import { parseHttpUrl } from '../notify/url.ts';

interface TelegramRuntimeConfig {
  botToken?: string;
  apiId?: number;
  apiHash?: string;
  session?: string;
}

/** Inteiro positivo opcional (ex.: TELEGRAM_API_ID): lixo vira undefined, nunca NaN. */
export const positiveIntEnv = (raw: string | undefined): number | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d{1,12}$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/** Porta TCP válida (`min..65535`): lixo, negativo, fracionário ou acima de 65535 cai no padrão. */
export const portEnv = (raw: string | undefined, fallback: number, min: 0 | 1 = 1): number => {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d{1,5}$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= min && parsed <= 65535 ? parsed : fallback;
};

/**
 * Ao contrário do resto do config (fixo no boot), os campos do Telegram podem ser configurados pela
 * própria UI em runtime (ver `routes/telegram-settings.ts`) — por isso ficam num objeto mutável separado,
 * em vez de dentro do `as const` abaixo.
 */
const telegram: TelegramRuntimeConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
  apiId: positiveIntEnv(process.env.TELEGRAM_API_ID),
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

interface TmdbRuntimeConfig {
  apiKey?: string;
  language: string;
  region: string;
}

interface OpenSubtitlesRuntimeConfig {
  apiKey?: string;
  languages: string;
}

interface NotifyRuntimeConfig {
  webhookUrl?: string;
  ntfyUrl?: string;
  discordUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  leadDays: number;
}

/** Chaves editáveis pela tela Credenciais (`routes/credentials.ts`): mutáveis em runtime, como telegram e drive. */
const tmdb: TmdbRuntimeConfig = {
  apiKey: process.env.TMDB_API_KEY?.trim() || undefined,
  language: process.env.TMDB_LANGUAGE?.trim() || 'pt-BR',
  region: process.env.TMDB_REGION?.trim() || 'BR',
};

const opensubtitles: OpenSubtitlesRuntimeConfig = {
  apiKey: process.env.OPENSUBTITLES_API_KEY?.trim() || undefined,
  languages: process.env.OPENSUBTITLES_LANGUAGES?.trim() || 'pt-BR,pt,en',
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

/** Antecedência do aviso de lançamento, em dias (0 a 7). Fora disso (ou lixo) volta ao padrão 0: nunca vira NaN. */
export const leadDaysEnv = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 7 ? parsed : 0;
};
/**
 * Interface em que o servidor escuta. O padrão é loopback; só o container Docker define `0.0.0.0`, porque o
 * port mapping chega pela interface do container. A barreira de Host/Origin (`http/security.ts`) continua valendo.
 */
export const listenHost = (raw: string | undefined): string => raw?.trim() || '127.0.0.1';

const notify: NotifyRuntimeConfig = {
  webhookUrl: parseHttpUrl(process.env.NOTIFY_WEBHOOK_URL),
  ntfyUrl: parseHttpUrl(process.env.NOTIFY_NTFY_URL),
  discordUrl: parseHttpUrl(process.env.NOTIFY_DISCORD_WEBHOOK_URL),
  telegramBotToken: process.env.NOTIFY_TELEGRAM_BOT_TOKEN?.trim() || undefined,
  telegramChatId: process.env.NOTIFY_TELEGRAM_CHAT_ID?.trim() || undefined,
  leadDays: leadDaysEnv(process.env.NOTIFY_LEAD_DAYS),
};

export const config = {
  host: listenHost(process.env.HOST),
  port: portEnv(process.env.PORT, 7799, 1),
  /**
   * Avisos de lançamento (ver `notify/`). Os destinos vêm SÓ do ambiente, nunca de request: a URL do ntfy/webhook
   * costuma carregar um token. Sem nenhuma URL válida o agendador nem sobe.
   */
  notify,
  dbPath: process.env.DB_PATH ?? 'data/nerd-watch.db',
  tmdb,
  opensubtitles,
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
   * Addons instalados no boot a partir do ambiente (`ADDON_MANIFEST_URLS`, separados por vírgula).
   * O link pode carregar token no caminho, então ele vive no `.env`/segredo — nunca no repositório.
   * Sem a variável o app segue como sempre: instalação só manual, pela tela de addons.
   */
  addons: {
    manifestUrls: (process.env.ADDON_MANIFEST_URLS?.trim() || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  },
  /**
   * Engine de torrent P2P. Dois caminhos: o player P2P do Internet Archive (o app monta a URL do
   * .torrent a partir do `identifier` do item) e o provider genérico, que aceita o magnet ou a URL
   * .torrent que VOCÊ cola (ver docs/providers/torrent.md). Addons instalados também tocam torrent:
   * o infohash vem do addon, passa pelo mesmo normalizador do magnet e cai neste engine.
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
  /**
   * Acesso remoto opcional (ver `http/access.ts`). Sem `ACCESS_TOKEN` nada muda. `trustProxy` só liga a leitura de
   * `X-Forwarded-Proto`, para o cookie sair com `Secure` atrás de um proxy HTTPS.
   */
  access: {
    token: parseAccessToken(process.env.ACCESS_TOKEN),
    trustProxy: process.env.ACCESS_TRUST_PROXY === 'true',
  },
  /** Transmissão para a TV na rede local (DLNA/UPnP + link LAN sob demanda). `port: 0` escolhe porta livre. */
  cast: {
    host: process.env.CAST_HOST?.trim() || undefined,
    port: portEnv(process.env.CAST_PORT, 0, 0),
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
