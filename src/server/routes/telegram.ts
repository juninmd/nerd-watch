import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { fetchHeaders } from '../providers/sources/http.ts';
import { originAllowed } from '../security.ts';
import {
  countTelegramItemsByChannel,
  deleteTelegramChannel,
  deleteTelegramChannels,
  getTelegramChannel,
  getTelegramItem,
  listRecentTelegramItems,
  listTelegramChannels,
  listTelegramItems,
  updateChannelCursor,
  upsertTelegramChannel,
  upsertTelegramItems,
} from '../repo/telegram.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { TelegramChannelNotFoundError, fetchPublicChannelItems, fetchPublicChannelPage, resolvePublicPlayUrl } from '../providers/telegram/public.ts';
import { TelegramBotNotConfiguredError, resolveBotFileUrl, telegramBotEnabled } from '../providers/telegram/bot.ts';
import {
  TelegramPersonalNotConfiguredError,
  fetchPersonalChannelItems,
  listPersonalChannels,
  streamPersonalItem,
  telegramPersonalEnabled,
} from '../providers/telegram/personal.ts';
import { getSource } from '../providers/sources/registry.ts';
import { playSourceItem, refreshSourceChannel } from '../providers/sources/service.ts';
import type { TelegramChannel } from '../repo/telegram.ts';
import { applyPublicInfo, syncChannelInfo } from '../telegram-channel-info.ts';
import { localizeThumbs, needsThumb } from '../telegram-item-thumbs.ts';
import { itemEmbedUrl, toChannelResponse } from '../telegram-channel-dto.ts';
import { readPhoto, readThumb } from '../telegram-photos.ts';
import type { TelegramChannelMode } from '../types.ts';

export const telegramRoutes = new Hono();

const isMode = (v: unknown): v is TelegramChannelMode => v === 'public' || v === 'personal' || v === 'bot';
const HANDLE_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

telegramRoutes.get('/channels', async (c) => {
  const db = await getDb();
  const channels = listTelegramChannels(db);
  const counts = countTelegramItemsByChannel(db);
  return c.json({
    channels: channels.map((ch) => toChannelResponse(ch, counts.get(ch.id) ?? 0)),
  });
});

const RECENT_DEFAULT = 12;
const RECENT_MAX = 50;

telegramRoutes.get('/recent', async (c) => {
  const requested = Number(c.req.query('limit') ?? RECENT_DEFAULT);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, RECENT_MAX) : RECENT_DEFAULT;
  const db = await getDb();
  return c.json({
    items: listRecentTelegramItems(db, limit).map((i) => ({
      channelId: i.channel_id,
      channelTitle: i.channel_title,
      handle: i.channel_handle,
      messageId: i.message_id,
      caption: i.caption,
      durationSeconds: i.duration_seconds,
      thumbnailUrl: i.thumbnail_url,
      postedAt: i.posted_at,
    })),
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
      const page = await fetchPublicChannelPage(handle);
      const items = page.items;
      let channel = upsertTelegramChannel(db, { handle, mode: 'public' });
      if (await applyPublicInfo(db, channel, page.info)) channel = getTelegramChannel(db, channel.id) ?? channel;
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
      await localizeThumbs(db, channel, saved);
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
    let channel = upsertTelegramChannel(db, { handle, mode: 'bot' });
    if (await syncChannelInfo(db, channel)) channel = getTelegramChannel(db, channel.id) ?? channel;
    return c.json(toChannelResponse(channel, listTelegramItems(db, channel.id).length), 201);
  }

  if (!telegramPersonalEnabled()) {
    return c.json({ error: 'conta pessoal do Telegram não configurada — rode `bun run telegram:login` e configure o .env' }, 501);
  }
  try {
    const items = await fetchPersonalChannelItems(handle);
    let channel = upsertTelegramChannel(db, { handle, mode: 'personal' });
    if (await syncChannelInfo(db, channel)) channel = getTelegramChannel(db, channel.id) ?? channel;
    const saved = upsertTelegramItems(
      db,
      channel.id,
      items.map((i) => ({ messageId: i.messageId, caption: i.caption, durationSeconds: i.durationSeconds, postedAt: i.postedAt })),
    );
    const oldest = saved[0]?.message_id ?? null;
    if (oldest) updateChannelCursor(db, channel.id, oldest);
    return c.json(toChannelResponse(channel, saved.length), 201);
  } catch (err) {
    if (err instanceof TelegramPersonalNotConfiguredError) return c.json({ error: err.message }, 501);
    return c.json({ error: 'não foi possível ler esse canal com a conta pessoal agora' }, 502);
  }
});

telegramRoutes.get('/channels/:id', async (c) => {
  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);

  // Mais recente primeiro: é a ordem da lista de vídeos e da fila de reprodução (do último ao mais antigo).
  const items = listTelegramItems(db, channel.id).reverse();
  return c.json({
    ...toChannelResponse(channel, items.length),
    library: getLibraryEntryByTitle(db, channel.id),
    items: items.map((i) => ({
      messageId: i.message_id,
      caption: i.caption,
      durationSeconds: i.duration_seconds,
      thumbnailUrl: i.thumbnail_url,
      postedAt: i.posted_at,
      embedUrl: itemEmbedUrl(channel, i.file_ref),
    })),
  });
});

telegramRoutes.get('/channels/:id/photo', async (c) => {
  const photo = await readPhoto(c.req.param('id'));
  if (!photo) return c.json({ error: 'foto não encontrada' }, 404);
  return new Response(new Uint8Array(photo.bytes), { headers: { 'Content-Type': photo.type, 'Cache-Control': 'public, max-age=86400' } });
});

telegramRoutes.get('/channels/:id/items/:messageId/thumb', async (c) => {
  const thumb = await readThumb(c.req.param('id'), c.req.param('messageId'));
  if (!thumb) return c.json({ error: 'miniatura não encontrada' }, 404);
  return new Response(new Uint8Array(thumb.bytes), { headers: { 'Content-Type': thumb.type, 'Cache-Control': 'public, max-age=86400' } });
});

const INFO_CONCURRENCY = 3;

/** Completa canais antigos: nome/foto/descrição (só tinham o @) e miniaturas dos vídeos (ainda no CDN ou ausentes). */
telegramRoutes.post('/channels/refresh-info', async (c) => {
  const db = await getDb();
  const needsInfo = (ch: TelegramChannel) => !ch.title.poster_path || ch.title.title.startsWith('@');
  const pending = listTelegramChannels(db).filter((ch) => needsInfo(ch) || listTelegramItems(db, ch.id).some(needsThumb));
  let updated = 0;
  for (let i = 0; i < pending.length; i += INFO_CONCURRENCY) {
    const results = await Promise.all(
      pending.slice(i, i + INFO_CONCURRENCY).map(async (ch) => {
        const infoDone = needsInfo(ch) ? await syncChannelInfo(db, ch) : false;
        const thumbs = await localizeThumbs(db, ch, listTelegramItems(db, ch.id));
        return infoDone || thumbs > 0;
      }),
    );
    updated += results.filter(Boolean).length;
  }
  return c.json({ checked: pending.length, updated });
});

const BULK_DELETE_MAX = 500;

telegramRoutes.post('/channels/bulk-delete', async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > BULK_DELETE_MAX || !ids.every((id) => typeof id === 'string')) {
    return c.json({ error: `ids deve ser uma lista de 1 a ${BULK_DELETE_MAX} ids de canal` }, 400);
  }
  const db = await getDb();
  return c.json({ removed: deleteTelegramChannels(db, ids) });
});

telegramRoutes.get('/my-channels', async (c) => {
  if (!telegramPersonalEnabled()) return c.json({ error: 'entre com a conta pessoal (QR code) para listar os seus canais' }, 501);
  try {
    const mine = await listPersonalChannels();
    const db = await getDb();
    const added = new Set(listTelegramChannels(db).map((ch) => ch.handle.toLowerCase()));
    return c.json({ channels: mine.map((ch) => ({ ...ch, added: ch.handle !== null && added.has(ch.handle.toLowerCase()) })) });
  } catch (err) {
    if (err instanceof TelegramPersonalNotConfiguredError) return c.json({ error: err.message }, 501);
    return c.json({ error: 'não foi possível listar os seus canais agora' }, 502);
  }
});

telegramRoutes.delete('/channels/:id', async (c) => {
  const db = await getDb();
  if (!deleteTelegramChannel(db, c.req.param('id'))) return c.json({ error: 'canal não encontrado' }, 404);
  return c.body(null, 204);
});

telegramRoutes.post('/channels/:id/refresh', async (c) => {
  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);
  if (getSource(channel.mode)) {
    const result = await refreshSourceChannel(db, channel);
    return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result);
  }
  if (channel.mode !== 'public' && channel.mode !== 'personal') {
    return c.json({ error: `atualização automática ainda não existe pro modo "${channel.mode}"` }, 501);
  }

  try {
    const saved =
      channel.mode === 'public'
        ? upsertTelegramItems(
            db,
            channel.id,
            (await fetchPublicChannelItems(channel.handle)).map((i) => ({
              messageId: i.messageId,
              caption: i.caption,
              durationSeconds: i.durationSeconds,
              thumbnailUrl: i.thumbnailUrl,
              postedAt: i.postedAt,
            })),
          )
        : upsertTelegramItems(
            db,
            channel.id,
            (await fetchPersonalChannelItems(channel.handle)).map((i) => ({
              messageId: i.messageId,
              caption: i.caption,
              durationSeconds: i.durationSeconds,
              postedAt: i.postedAt,
            })),
          );
    await syncChannelInfo(db, channel);
    await localizeThumbs(db, channel, saved);
    return c.json({ itemCount: saved.length });
  } catch (err) {
    if (err instanceof TelegramPersonalNotConfiguredError) return c.json({ error: err.message }, 501);
    return c.json({ error: 'não foi possível atualizar esse canal agora' }, 502);
  }
});

telegramRoutes.get('/channels/:id/items/:messageId/play', async (c) => {
  // GET é isento do check de Origin em toda a app por ser normalmente idempotente/barato (ver security.ts),
  // mas essa rota tem efeito colateral real e caro (proxy de download via MTProto/Bot API) — sem esse check
  // qualquer aba de terceiro aberta no mesmo navegador podia forçar downloads repetidos contra o Telegram
  // do usuário só com fetch(), sem precisar ler a resposta (CORS não bloqueia isso, é abuso por efeito colateral).
  if (!originAllowed(c.req.header('Origin') ?? '', c.req.header('Host') ?? '')) return c.json({ error: 'origem não permitida' }, 403);

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

  if (getSource(channel.mode)) return playSourceItem(db, channel, messageId, c.req.header('Range'));

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
    const upstream = await fetchHeaders(fetch, resolved.url, { headers: range ? { Range: range } : {} }, 30_000);
    if (!upstream.ok && upstream.status !== 206) return c.json({ error: `Telegram respondeu ${upstream.status}` }, 502);

    const headers = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // Conta pessoal: baixa via MTProto em stream (sem bufferizar o arquivo inteiro) respeitando o Range pedido.
  const rangeHeader = c.req.header('Range');
  const rangeMatch = rangeHeader ? /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim()) : null;
  const range = { start: rangeMatch ? Number(rangeMatch[1]) : 0, end: rangeMatch?.[2] ? Number(rangeMatch[2]) : null };

  let resolved: Awaited<ReturnType<typeof streamPersonalItem>>;
  try {
    resolved = await streamPersonalItem(channel.handle, messageId, range);
  } catch (err) {
    if (err instanceof TelegramPersonalNotConfiguredError) return c.json({ error: err.message }, 501);
    return c.json({ error: 'não foi possível acessar o Telegram com a conta pessoal agora' }, 502);
  }
  if (!resolved.ok) {
    if (resolved.reason === 'range_not_satisfiable') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${resolved.totalSize}` } });
    }
    return c.json({ error: 'vídeo não encontrado nesse canal' }, 404);
  }

  const stream = resolved.data;
  const headers = new Headers({
    'Content-Type': stream.contentType,
    'Content-Length': String(stream.end - stream.start + 1),
    'Accept-Ranges': 'bytes',
  });
  if (rangeMatch) headers.set('Content-Range', `bytes ${stream.start}-${stream.end}/${stream.totalSize}`);
  return new Response(stream.stream, { status: rangeMatch ? 206 : 200, headers });
});
