/**
 * Endereço de um canal/grupo do Telegram, venha de onde vier (@usuário, link do t.me, link de mensagem,
 * id da Bot API). Canais públicos são `usuario`; canais e grupos privados não têm @usuário e são `c/<id>` —
 * a mesma forma do link `t.me/c/<id>/<msg>`, então `https://t.me/${handle}/${msg}` continua válido.
 */
export interface TelegramRef {
  handle: string;
  private: boolean;
}

const PUBLIC_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
/** Id interno de canal: sem zero à esquerda e com até 13 dígitos (os reais têm 10 ou 11 hoje). */
const CHANNEL_ID = String.raw`[1-9]\d{0,12}`;
const PRIVATE_HANDLE_RE = new RegExp(`^c/(${CHANNEL_ID})$`);
const BARE_ID_RE = new RegExp(`^(?:-100)?(${CHANNEL_ID})$`);
/** Caminhos do t.me que parecem @usuário mas são recursos do Telegram (convite, sticker, proxy…). */
const RESERVED = new Set(['joinchat', 'addstickers', 'addemoji', 'addtheme', 'addlist', 'setlanguage', 'share', 'proxy', 'socks', 'login', 'confirmphone', 'invoice', 'boost', 'giftcode', 'contact']);
const TME_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog', 'www.t.me', 'www.telegram.me']);

export const privateHandle = (channelId: string): string => `c/${channelId}`;

export const privateChannelId = (handle: string): string | null => PRIVATE_HANDLE_RE.exec(handle)?.[1] ?? null;

export const isPrivateHandle = (handle: string): boolean => privateChannelId(handle) !== null;

const privateRef = (channelId: string): TelegramRef => ({ handle: privateHandle(channelId), private: true });

const publicRef = (name: string): TelegramRef | null => (PUBLIC_RE.test(name) && !RESERVED.has(name.toLowerCase()) ? { handle: name, private: false } : null);

const fromUrl = (url: URL): TelegramRef | null => {
  if (url.protocol === 'tg:') {
    // tg://privatepost?channel=<id>&post=<n> é o link de mensagem de canal privado dentro do app.
    const id = url.hostname === 'privatepost' ? url.searchParams.get('channel') : null;
    return id && new RegExp(`^${CHANNEL_ID}$`).test(id) ? privateRef(id) : null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !TME_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first === 'c') return second && new RegExp(`^${CHANNEL_ID}$`).test(second) ? privateRef(second) : null;
  // `+abc` e `joinchat/abc` são convites: só valem depois de entrar no canal, não dão acesso a nada sozinhos.
  if (first === 's') return second ? publicRef(second) : null;
  return first ? publicRef(first) : null;
};

/** Normaliza o que o usuário colou; `null` quando não dá para saber de qual canal se trata. */
export const parseTelegramRef = (input: string): TelegramRef | null => {
  const text = input.trim();
  if (!text) return null;
  const canonical = PRIVATE_HANDLE_RE.exec(text);
  if (canonical?.[1]) return privateRef(canonical[1]);
  const bare = BARE_ID_RE.exec(text);
  if (bare?.[1]) return privateRef(bare[1]);
  if (/^(?:https?|tg):\/\//i.test(text) || /^(?:www\.)?(?:t|telegram)\.(?:me|dog)\//i.test(text)) {
    try {
      return fromUrl(new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`));
    } catch {
      return null;
    }
  }
  return publicRef(text.replace(/^@/, ''));
};
