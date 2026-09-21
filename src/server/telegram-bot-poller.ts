import type { Database } from 'bun:sqlite';
import { getDb } from './db.ts';
import { getTelegramChannelByHandle, upsertTelegramItems } from './repo/telegram.ts';
import { getChannelPostUpdates, telegramBotEnabled, type TgVideoMessage } from './providers/telegram/bot.ts';

/**
 * Loop de long polling em background: só grava posts de canais que o usuário já cadastrou em modo 'bot'
 * pela UI (`POST /api/telegram/channels`) — posts de outros chats onde o bot também esteja são ignorados.
 * Offset não é persistido entre restarts (fica em memória); reprocessar updates antigos é inofensivo porque
 * `upsertTelegramItems` é idempotente por (channel_id, message_id).
 */
let offset = 0;
let running = false;

const storePost = (db: Database, post: TgVideoMessage): void => {
  const handle = post.chat.username;
  if (!handle) return; // canal sem @username público não dá pra casar com o que foi cadastrado
  const channel = getTelegramChannelByHandle(db, handle);
  if (channel?.mode !== 'bot') return;

  upsertTelegramItems(db, channel.id, [
    {
      messageId: String(post.message_id),
      caption: post.caption ?? null,
      durationSeconds: post.video.duration ?? null,
      postedAt: new Date(post.date * 1000).toISOString(),
      fileRef: post.video.file_id,
    },
  ]);
};

const loop = async (): Promise<void> => {
  const db = await getDb();
  while (running) {
    try {
      const { nextOffset, posts } = await getChannelPostUpdates(offset);
      offset = nextOffset;
      for (const post of posts) storePost(db, post);
    } catch (err) {
      // Token revogado, 409 de outro consumidor do getUpdates, falha de rede: sem log isso é um poller
      // morto e silencioso — canais em modo bot simplesmente param de ganhar vídeos, sem nenhum sinal em lugar nenhum.
      console.error('[telegram bot-poller] falhou:', err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

export const startTelegramBotPoller = (): void => {
  if (!telegramBotEnabled() || running) return;
  running = true;
  void loop();
};

export const stopTelegramBotPoller = (): void => {
  running = false;
};
