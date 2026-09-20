import { config, telegramBotEnabled } from '../../config.ts';

/**
 * Bot do Telegram: a Bot API não tem `getChatHistory` (isso só existe na Client API/TDLib) — um bot só
 * recebe posts a partir do momento em que é adicionado como admin do canal, via `getUpdates`/long polling.
 * `getFile` na nuvem tem teto de 20MB por arquivo; acima disso só rodando um `telegram-bot-api` self-hosted
 * (fora do escopo daqui — documentado no `.env.example`).
 */
const MAX_CLOUD_FILE_BYTES = 20 * 1024 * 1024;
const API_BASE = (token: string) => `https://api.telegram.org/bot${token}`;

export class TelegramBotNotConfiguredError extends Error {
  constructor() {
    super('TELEGRAM_BOT_TOKEN não configurado — crie um bot no @BotFather e adicione o token ao .env.');
    this.name = 'TelegramBotNotConfiguredError';
  }
}

export interface TgVideoMessage {
  message_id: number;
  chat: { id: number; username?: string };
  date: number;
  caption?: string;
  video: { file_id: string; file_size?: number; duration?: number };
}

interface TgUpdate {
  update_id: number;
  channel_post?: {
    message_id: number;
    chat: { id: number; username?: string };
    date: number;
    caption?: string;
    video?: { file_id: string; file_size?: number; duration?: number };
  };
}

const call = async <T>(method: string, params: Record<string, string> = {}): Promise<T> => {
  if (!config.telegram.botToken) throw new TelegramBotNotConfiguredError();
  const url = new URL(`${API_BASE(config.telegram.botToken)}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram Bot API: ${method} falhou`);
  // biome-ignore lint/style/noNonNullAssertion: data.ok garante result presente pela própria API
  return data.result!;
};

/** Long polling: bloqueia no servidor do Telegram até ter update novo ou 25s se passarem. */
export const getChannelPostUpdates = async (offset: number): Promise<{ nextOffset: number; posts: TgVideoMessage[] }> => {
  const updates = await call<TgUpdate[]>('getUpdates', {
    offset: String(offset),
    timeout: '25',
    allowed_updates: JSON.stringify(['channel_post']),
  });

  let nextOffset = offset;
  const posts: TgVideoMessage[] = [];
  for (const u of updates) {
    nextOffset = u.update_id + 1;
    if (u.channel_post?.video) posts.push(u.channel_post as TgVideoMessage);
  }
  return { nextOffset, posts };
};

export type BotFileResolution = { ok: true; url: string } | { ok: false; reason: 'too_large' | 'not_found' };

export const resolveBotFileUrl = async (fileId: string): Promise<BotFileResolution> => {
  if (!config.telegram.botToken) throw new TelegramBotNotConfiguredError();
  try {
    const result = await call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (result.file_size && result.file_size > MAX_CLOUD_FILE_BYTES) return { ok: false, reason: 'too_large' };
    if (!result.file_path) return { ok: false, reason: 'not_found' };
    return { ok: true, url: `https://api.telegram.org/file/bot${config.telegram.botToken}/${result.file_path}` };
  } catch (err) {
    if (err instanceof Error && /too big/i.test(err.message)) return { ok: false, reason: 'too_large' };
    return { ok: false, reason: 'not_found' };
  }
};

export { telegramBotEnabled };
