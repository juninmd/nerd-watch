import { Hono } from 'hono';
import { getDb } from '../db.ts';
import {
  getTelegramChannel,
  getTelegramItem,
  listTelegramChannels,
  listTelegramItems,
  updateChannelCursor,
  upsertTelegramChannel,
  upsertTelegramItems,
} from '../repo/telegram.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { TelegramChannelNotFoundError, fetchPublicChannelItems, resolvePublicPlayUrl } from '../providers/telegram/public.ts';
import { TelegramBotNotConfiguredError, resolveBotFileUrl, telegramBotEnabled } from '../providers/telegram/bot.ts';
import type { TelegramChannel } from '../repo/telegram.ts';
import type { TelegramChannelMode } from '../types.ts';

export const telegramRoutes = new Hono();

const isMode = (v: unknown): v is TelegramChannelMode => v === 'public' || v === 'personal' || v === 'bot';
const HANDLE_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

const toChannelResponse = (channel: TelegramChannel, itemCount: number) => ({
  titleId: channel.id,
  handle: channel.handle,
  mode: channel.mode,
  title: channel.title.title,
  posterUrl: channel.title.poster_path,
  itemCount,
});

telegramRoutes.get('/channels', async (c) => {
  const db = await getDb();
  const channels = listTelegramChannels(db);
  return c.json({
    channels: channels.map((ch) => toChannelResponse(ch, listTelegramItems(db, ch.id).length)),
  });
});

telegramRoutes.post('/channels', async (c) => {
  const body = await c.req.json<{ handle?: string; mode?: string }>().catch(() => null);
  const handle = body?.handle?.trim().replace(/^@/, '');
  if (!handle || !HANDLE_RE.test(handle)) return c.json({ error: 'handle inválido (use o @usuário do canal, sem espaços)' }, 400);
  if (!isMode(body?.mode)) return c.json({ error: 'mode deve ser "public", "personal" ou "bot"' }, 400);

  const db = await getDb();

  if (body.mode === 'public') {
    try {
      const items = await fetchPublicChannelItems(handle);
      const channel = upsertTelegramChannel(db, { handle, mode: 'public' });
      const saved = upsertTelegramItems(
        db,
        channel.id,
        items.map((i) => ({
          messageId: i.messageId,
          caption: i.caption,
          durationSeconds: i.durationSeconds,
          thumbnailUrl: i.thumbnailUrl,
          postedAt: i.postedAt,
        })),
      );
      const oldest = saved[0]?.message_id ?? null;
      if (oldest) updateChannelCursor(db, channel.id, oldest);
      return c.json(toChannelResponse(channel, saved.length), 201);
    } catch (err) {
      if (err instanceof TelegramChannelNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: 'não foi possível ler a prévia pública desse canal agora' }, 502);
    }
  }

  if (body.mode === 'bot') {
    if (!telegramBotEnabled()) return c.json({ error: 'TELEGRAM_BOT_TOKEN não configurado — adicione ao .env (crie o bot no @BotFather)' }, 501);
    const channel = upsertTelegramChannel(db, { handle, mode: 'bot' });
    return c.json(toChannelResponse(channel, listTelegramItems(db, channel.id).length), 201);
  }

  return c.json({ error: `modo "${body.mode}" ainda não implementado` }, 501);
});

telegramRoutes.get('/channels/:id', async (c) => {
  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);

  const items = listTelegramItems(db, channel.id);
  return c.json({
    ...toChannelResponse(channel, items.length),
    library: getLibraryEntryByTitle(db, channel.id),
    items: items.map((i) => ({
      messageId: i.message_id,
      caption: i.caption,
      durationSeconds: i.duration_seconds,
      thumbnailUrl: i.thumbnail_url,
      postedAt: i.posted_at,
    })),
  });
});

telegramRoutes.post('/channels/:id/refresh', async (c) => {
  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);
  if (channel.mode !== 'public') return c.json({ error: `atualização automática ainda não existe pro modo "${channel.mode}"` }, 501);

  try {
    const items = await fetchPublicChannelItems(channel.handle);
    const saved = upsertTelegramItems(
      db,
      channel.id,
      items.map((i) => ({
        messageId: i.messageId,
        caption: i.caption,
        durationSeconds: i.durationSeconds,
        thumbnailUrl: i.thumbnailUrl,
        postedAt: i.postedAt,
      })),
    );
    return c.json({ itemCount: saved.length });
  } catch {
    return c.json({ error: 'não foi possível atualizar esse canal agora' }, 502);
  }
});

telegramRoutes.get('/channels/:id/items/:messageId/play', async (c) => {
  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);
  const messageId = c.req.param('messageId');

  if (channel.mode === 'public') {
    // Token do CDN público do Telegram já vem na própria URL e não é segredo nosso — redirect direto é seguro.
    const url = await resolvePublicPlayUrl(channel.handle, messageId);
    if (!url) return c.json({ error: 'não foi possível obter uma URL de reprodução válida agora' }, 502);
    return c.redirect(url, 302);
  }

  if (channel.mode === 'bot') {
    const item = getTelegramItem(db, channel.id, messageId);
    if (!item?.file_ref) return c.json({ error: 'vídeo não encontrado pra esse canal' }, 404);

    let resolved: Awaited<ReturnType<typeof resolveBotFileUrl>>;
    try {
      resolved = await resolveBotFileUrl(item.file_ref);
    } catch (err) {
      if (err instanceof TelegramBotNotConfiguredError) return c.json({ error: err.message }, 501);
      return c.json({ error: 'não foi possível resolver o arquivo no Telegram agora' }, 502);
    }
    if (!resolved.ok) {
      return resolved.reason === 'too_large'
        ? c.json({ error: 'esse vídeo passa do limite de 20MB da Bot API na nuvem — troque esse canal pro modo público ou conta pessoal' }, 413)
        : c.json({ error: 'arquivo não encontrado no Telegram' }, 404);
    }

    // Proxy: a URL da Bot API carrega o token do bot no path — nunca expor isso direto pro cliente.
    const range = c.req.header('Range');
    const upstream = await fetch(resolved.url, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(30000) });
    if (!upstream.ok && upstream.status !== 206) return c.json({ error: `Telegram respondeu ${upstream.status}` }, 502);

    const headers = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  return c.json({ error: `reprodução ainda não implementada pro modo "${channel.mode}"` }, 501);
});
