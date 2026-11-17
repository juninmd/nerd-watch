import { parseHttpUrl } from '../notify/url.ts';

/** Formatos aceitos, compartilhados com as rotas antigas de Telegram e Drive (uma verdade só). */
export const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
export const API_HASH_RE = /^[a-f0-9]{32}$/i;
export const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
export const GOOGLE_CLIENT_SECRET_RE = /^[A-Za-z0-9_-]{10,120}$/;

export type CredentialGroup = 'catalog' | 'telegram' | 'drive' | 'notify';

export interface CredentialField {
  key: string;
  label: string;
  group: CredentialGroup;
  /** Segredo: o valor nunca sai do servidor (só "configurado" e uma pista curta). */
  secret: boolean;
  help: string;
  placeholder: string;
  /** Mudar o valor só vale depois de reiniciar o app (ex.: o agendador de avisos sobe no boot). */
  restart?: boolean;
  /** Mensagem de erro, ou `null` quando o valor é aceito. Recebe o valor já aparado e não vazio. */
  validate: (value: string) => string | null;
  /** Há uma chamada de teste ao serviço (ver `tester.ts`). */
  testable: boolean;
}

const matches = (re: RegExp, message: string) => (value: string) => (re.test(value) ? null : message);
const httpUrl = (value: string) => (parseHttpUrl(value) ? null : 'URL http(s) inválida');

export const CREDENTIAL_FIELDS: readonly CredentialField[] = [
  {
    key: 'TMDB_API_KEY',
    label: 'Chave da TMDB',
    group: 'catalog',
    secret: true,
    help: 'Catálogo de filmes e séries. Aceita a chave v3 ou o token v4 (eyJ…). Gere em themoviedb.org/settings/api.',
    placeholder: 'chave v3 ou token v4',
    validate: matches(/^[A-Za-z0-9_.-]{20,}$/, 'chave da TMDB inválida'),
    testable: true,
  },
  {
    key: 'OPENSUBTITLES_API_KEY',
    label: 'Chave da OpenSubtitles',
    group: 'catalog',
    secret: true,
    help: 'Opcional: segunda fonte de legendas, com cota diária. Gere em opensubtitles.com/consumers.',
    placeholder: 'api key',
    validate: matches(/^[A-Za-z0-9_-]{16,64}$/, 'chave da OpenSubtitles inválida'),
    testable: true,
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    label: 'Token do bot',
    group: 'telegram',
    secret: true,
    help: 'Do @BotFather. Permite ler canais onde o bot é administrador.',
    placeholder: '123456:ABC-…',
    validate: matches(BOT_TOKEN_RE, 'token do bot inválido (formato 123456:ABC-…)'),
    testable: true,
  },
  {
    key: 'TELEGRAM_API_ID',
    label: 'api_id',
    group: 'telegram',
    secret: false,
    help: 'Conta pessoal do Telegram. Gere em my.telegram.org.',
    placeholder: '1234567',
    validate: matches(/^[1-9]\d{0,15}$/, 'api_id inválido (número inteiro positivo)'),
    testable: false,
  },
  {
    key: 'TELEGRAM_API_HASH',
    label: 'api_hash',
    group: 'telegram',
    secret: true,
    help: '32 caracteres hexadecimais, do mesmo painel do api_id.',
    placeholder: '32 caracteres hexadecimais',
    validate: matches(API_HASH_RE, 'api_hash inválido (32 caracteres hexadecimais)'),
    testable: false,
  },
  {
    key: 'GOOGLE_CLIENT_ID',
    label: 'Client ID do Google',
    group: 'drive',
    secret: false,
    help: 'Google Drive. Trocar o client ID desconecta a conta atual.',
    placeholder: '…apps.googleusercontent.com',
    validate: matches(GOOGLE_CLIENT_ID_RE, 'client ID inválido (termina em .apps.googleusercontent.com)'),
    testable: false,
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    label: 'Client secret do Google',
    group: 'drive',
    secret: true,
    help: 'Do mesmo cliente OAuth. A conexão da conta continua em Conexões.',
    placeholder: 'GOCSPX-…',
    validate: matches(GOOGLE_CLIENT_SECRET_RE, 'client secret inválido'),
    testable: false,
  },
  {
    key: 'NOTIFY_DISCORD_WEBHOOK_URL',
    label: 'Webhook do Discord',
    group: 'notify',
    secret: true,
    help: 'A URL carrega o token do canal.',
    placeholder: 'https://discord.com/api/webhooks/…',
    restart: true,
    validate: httpUrl,
    testable: true,
  },
  {
    key: 'NOTIFY_NTFY_URL',
    label: 'URL do ntfy',
    group: 'notify',
    secret: true,
    help: 'Tópico do ntfy; em servidor privado a URL costuma carregar um token.',
    placeholder: 'https://ntfy.sh/meu-topico',
    restart: true,
    validate: httpUrl,
    testable: false,
  },
  {
    key: 'NOTIFY_WEBHOOK_URL',
    label: 'Webhook genérico',
    group: 'notify',
    secret: true,
    help: 'Recebe um POST JSON por lançamento.',
    placeholder: 'https://…',
    restart: true,
    validate: httpUrl,
    testable: false,
  },
  {
    key: 'NOTIFY_TELEGRAM_BOT_TOKEN',
    label: 'Token do bot de avisos',
    group: 'notify',
    secret: true,
    help: 'Bot que envia os avisos de lançamento (pode ser outro que o das fontes).',
    placeholder: '123456:ABC-…',
    restart: true,
    validate: matches(BOT_TOKEN_RE, 'token do bot inválido (formato 123456:ABC-…)'),
    testable: true,
  },
  {
    key: 'NOTIFY_TELEGRAM_CHAT_ID',
    label: 'Chat ID dos avisos',
    group: 'notify',
    secret: false,
    help: 'Número do chat (negativo em grupos) ou @canal.',
    placeholder: '123456789',
    restart: true,
    validate: matches(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, 'chat ID inválido (número ou @canal)'),
    testable: false,
  },
];

export const GROUP_LABEL: Record<CredentialGroup, string> = {
  catalog: 'Catálogo e legendas',
  telegram: 'Telegram',
  drive: 'Google Drive',
  notify: 'Avisos de lançamento',
};

export const findField = (key: string): CredentialField | undefined => CREDENTIAL_FIELDS.find((f) => f.key === key);

/** Pista para reconhecer o segredo sem revelá-lo: só os 4 últimos caracteres, e só em valores longos. */
export const maskSecret = (value: string): string => (value.length >= 20 ? `••••••••${value.slice(-4)}` : '••••••••');
