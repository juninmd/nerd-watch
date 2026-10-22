import type { Database } from 'bun:sqlite';
import { listTelegramItems, getTelegramItem, pruneTelegramItems, setTelegramItemThumbnail, updateChannelCursor, upsertTelegramItems } from '../../repo/telegram.ts';
import type { TelegramChannel } from '../../repo/telegram.ts';
import { localizeThumbs, needsThumb } from '../../telegram-item-thumbs.ts';
import { getSource } from './registry.ts';
import { SourceError } from './types.ts';

const sourceOf = (channel: Pick<TelegramChannel, 'mode'>) => {
  const source = getSource(channel.mode);
  if (!source) throw new SourceError(`atualização automática ainda não existe pro modo "${channel.mode}"`, 501);
  return source;
};

/** Lê a origem, grava os vídeos (removendo os que sumiram) e traz as miniaturas para o disco. Devolve quantos itens ficaram. */
export const syncSourceChannel = async (db: Database, channel: TelegramChannel): Promise<number> => {
  const items = await sourceOf(channel).list(channel.handle);
  upsertTelegramItems(db, channel.id, items);
  pruneTelegramItems(
    db,
    channel.id,
    items.map((i) => i.messageId),
  );
  await localizeThumbs(db, channel, listTelegramItems(db, channel.id));
  // Link remoto que não virou arquivo local pode exigir token ou expirar: o navegador não deve tentar carregá-lo.
  const current = listTelegramItems(db, channel.id);
  for (const item of current) if (needsThumb(item) && item.thumbnail_url) setTelegramItemThumbnail(db, channel.id, item.message_id, null);
  const oldest = current[0]?.message_id ?? null;
  if (oldest) updateChannelCursor(db, channel.id, oldest);
  return current.length;
};

const errorBody = (err: unknown): { status: SourceError['status']; error: string } =>
  err instanceof SourceError ? { status: err.status, error: err.message } : { status: 502, error: 'não foi possível falar com a origem agora' };

export const refreshSourceChannel = async (db: Database, channel: TelegramChannel): Promise<{ itemCount: number } | { status: SourceError['status']; error: string }> => {
  try {
    return { itemCount: await syncSourceChannel(db, channel) };
  } catch (err) {
    return errorBody(err);
  }
};

/** Resposta de `GET …/items/:messageId/play`: a fonte decide entre proxy com Range e redirect. */
export const playSourceItem = async (db: Database, channel: TelegramChannel, messageId: string, range: string | undefined): Promise<Response> => {
  const item = getTelegramItem(db, channel.id, messageId);
  if (!item?.file_ref) return Response.json({ error: 'vídeo não encontrado nesse canal' }, { status: 404 });
  try {
    return await sourceOf(channel).play({ handle: channel.handle, fileRef: item.file_ref, range });
  } catch (err) {
    const { status, error } = errorBody(err);
    return Response.json({ error }, { status });
  }
};

export { errorBody as sourceErrorBody };

/** Repassa o corpo e os cabeçalhos de mídia de uma resposta remota (os segredos ficam no servidor). */
export const relayMedia = (upstream: Response, notFoundMessage: string): Response => {
  if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 416) {
    const missing = upstream.status === 404;
    return Response.json({ error: missing ? notFoundMessage : `a origem respondeu ${upstream.status}` }, { status: missing ? 404 : 502 });
  }
  const headers = new Headers();
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('accept-ranges')) headers.set('Accept-Ranges', 'bytes');
  return new Response(upstream.body, { status: upstream.status, headers });
};

const hash3 = (text: string): number => {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return h;
};

/**
 * O app ordena e navega por um `messageId` numérico que cresce com o tempo. Aqui ele vem da data (ms) e de três
 * dígitos estáveis derivados do identificador do arquivo: o mesmo arquivo recebe sempre o mesmo número entre
 * sincronizações, e arquivos do mesmo milissegundo não colidem na prática.
 */
export const syntheticMessageId = (dateIso: string | null | undefined, stableKey: string): string => {
  const ms = Date.parse(dateIso ?? '');
  return String((Number.isFinite(ms) ? ms : 0) * 1000 + hash3(stableKey));
};

export const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|avi|ogv|ts|wmv)$/i;

export const titleFromFilename = (name: string): string => name.replace(/\.[A-Za-z0-9]{2,5}$/, '').trim() || name;
