import type { Database } from 'bun:sqlite';
import type { TelegramChannelMode, TelegramChannelRow, TelegramItemRow, TitleRow } from '../types.ts';
import { upsertTitle } from './titles.ts';

export type TelegramChannel = TelegramChannelRow & { title: TitleRow };

const JOIN_SELECT = `
  SELECT
    c.id, c.mode, c.handle, c.cursor, c.created_at,
    t.id as t_id, t.source as t_source, t.source_id as t_source_id, t.media_type as t_media_type,
    t.title as t_title, t.original_title as t_original_title, t.overview as t_overview,
    t.poster_path as t_poster_path, t.backdrop_path as t_backdrop_path,
    t.release_date as t_release_date, t.vote_average as t_vote_average, t.created_at as t_created_at,
    t.metadata_status as t_metadata_status, t.metadata_refreshed_at as t_metadata_refreshed_at
  FROM telegram_channels c JOIN titles t ON t.id = c.id
`;

interface JoinedRow {
  id: string;
  mode: TelegramChannelMode;
  handle: string;
  cursor: string | null;
  created_at: string;
  t_id: string;
  t_source: TitleRow['source'];
  t_source_id: string;
  t_media_type: TitleRow['media_type'];
  t_title: string;
  t_original_title: string | null;
  t_overview: string | null;
  t_poster_path: string | null;
  t_backdrop_path: string | null;
  t_release_date: string | null;
  t_vote_average: number | null;
  t_created_at: string;
  t_metadata_status: string | null;
  t_metadata_refreshed_at: string | null;
}

const toChannel = (row: JoinedRow): TelegramChannel => ({
  id: row.id,
  mode: row.mode,
  handle: row.handle,
  cursor: row.cursor,
  created_at: row.created_at,
  title: {
    id: row.t_id,
    source: row.t_source,
    source_id: row.t_source_id,
    media_type: row.t_media_type,
    title: row.t_title,
    original_title: row.t_original_title,
    overview: row.t_overview,
    poster_path: row.t_poster_path,
    backdrop_path: row.t_backdrop_path,
    release_date: row.t_release_date,
    vote_average: row.t_vote_average,
    created_at: row.t_created_at,
    metadata_status: row.t_metadata_status,
    metadata_refreshed_at: row.t_metadata_refreshed_at,
  },
});

/** Usernames do Telegram não diferenciam maiúsculas/minúsculas — compara sem distinção pra não duplicar canal nem perder posts do bot por causa da casing exata digitada na UI. */
export const getTelegramChannelByHandle = (db: Database, handle: string): TelegramChannel | null => {
  const row = db.query<JoinedRow, [string]>(`${JOIN_SELECT} WHERE LOWER(c.handle) = LOWER(?)`).get(handle);
  return row ? toChannel(row) : null;
};

export const getTelegramChannel = (db: Database, id: string): TelegramChannel | null => {
  const row = db.query<JoinedRow, [string]>(`${JOIN_SELECT} WHERE c.id = ?`).get(id);
  return row ? toChannel(row) : null;
};

export const listTelegramChannels = (db: Database): TelegramChannel[] =>
  db.query<JoinedRow, []>(`${JOIN_SELECT} ORDER BY c.created_at DESC`).all().map(toChannel);

/** Uma query só pra contar itens de todos os canais, em vez de um SELECT * completo por canal (N+1). */
export const countTelegramItemsByChannel = (db: Database): Map<string, number> => {
  const rows = db.query<{ channel_id: string; count: number }, []>('SELECT channel_id, COUNT(*) as count FROM telegram_items GROUP BY channel_id').all();
  return new Map(rows.map((r) => [r.channel_id, r.count]));
};

/** Um canal Telegram é um `title` (source='telegram', media_type='tv' — conteúdo episódico contínuo). */
export const upsertTelegramChannel = (
  db: Database,
  input: { handle: string; mode: TelegramChannelMode; displayName?: string; posterUrl?: string | null },
): TelegramChannel => {
  const existing = getTelegramChannelByHandle(db, input.handle);
  if (existing) return existing;

  const titleRow = upsertTitle(db, {
    source: 'telegram',
    sourceId: input.handle,
    mediaType: 'tv',
    title: input.displayName ?? `@${input.handle}`,
    posterPath: input.posterUrl ?? null,
  });

  db.query(
    `INSERT INTO telegram_channels (id, mode, handle, cursor, created_at) VALUES ($id, $mode, $handle, NULL, $createdAt)`,
  ).run({ $id: titleRow.id, $mode: input.mode, $handle: input.handle, $createdAt: new Date().toISOString() });

  // biome-ignore lint/style/noNonNullAssertion: acabamos de inserir esta linha
  return getTelegramChannel(db, titleRow.id)!;
};

/** Apaga o `title` do canal; o ON DELETE CASCADE leva junto telegram_channels, telegram_items e a entrada da lista. */
export const deleteTelegramChannel = (db: Database, id: string): boolean =>
  db.query("DELETE FROM titles WHERE id = $id AND source = 'telegram'").run({ $id: id }).changes > 0;

/** Remove vários canais numa transação só; ids inexistentes são ignorados. Devolve quantos de fato saíram. */
export const deleteTelegramChannels = (db: Database, ids: string[]): number =>
  db.transaction((list: string[]) => list.reduce((n, id) => n + (deleteTelegramChannel(db, id) ? 1 : 0), 0))(ids);

/**
 * `cursor` é o id da mensagem mais antiga já lida (a próxima página começa antes dela). `HISTORY_END` diz que o
 * histórico acabou, então nem adianta perguntar ao Telegram de novo.
 */
export const HISTORY_END = 'end';

export const updateChannelCursor =(db: Database, channelId: string, cursor: string | null): void => {
  db.query('UPDATE telegram_channels SET cursor = $cursor WHERE id = $id').run({ $cursor: cursor, $id: channelId });
};

export const countTelegramItems = (db: Database, channelId: string): number =>
  db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM telegram_items WHERE channel_id = ?').get(channelId)?.n ?? 0;

export interface NewTelegramItem {
  messageId: string;
  caption?: string | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  postedAt?: string | null;
  /** Referência específica do provider pra resolver o arquivo depois (ex: `file_id` da Bot API). Nulo no modo público, que resolve por scraping. */
  fileRef?: string | null;
  width?: number | null;
  height?: number | null;
  supportsStreaming?: boolean | null;
  fileName?: string | null;
}

export const upsertTelegramItems = (db: Database, channelId: string, items: NewTelegramItem[]): TelegramItemRow[] => {
  const insert = db.query(
    `INSERT INTO telegram_items (id, channel_id, message_id, caption, duration_seconds, thumbnail_url, posted_at, file_ref, width, height, supports_streaming, file_name)
     VALUES ($id, $channelId, $messageId, $caption, $durationSeconds, $thumbnailUrl, $postedAt, $fileRef, $width, $height, $supportsStreaming, $fileName)
     ON CONFLICT (channel_id, message_id) DO UPDATE SET
       caption = excluded.caption, duration_seconds = excluded.duration_seconds,
       thumbnail_url = excluded.thumbnail_url, posted_at = excluded.posted_at, file_ref = excluded.file_ref,
       width = excluded.width, height = excluded.height, supports_streaming = excluded.supports_streaming, file_name = excluded.file_name`,
  );
  const tx = db.transaction((rows: NewTelegramItem[]) => {
    for (const item of rows) {
      insert.run({
        $id: crypto.randomUUID(),
        $channelId: channelId,
        $messageId: item.messageId,
        $caption: item.caption ?? null,
        $durationSeconds: item.durationSeconds ?? null,
        $thumbnailUrl: item.thumbnailUrl ?? null,
        $postedAt: item.postedAt ?? null,
        $fileRef: item.fileRef ?? null,
        $width: item.width ?? null,
        $height: item.height ?? null,
        $supportsStreaming: item.supportsStreaming == null ? null : item.supportsStreaming ? 1 : 0,
        $fileName: item.fileName ?? null,
      });
    }
  });
  tx(items);
  return listTelegramItems(db, channelId);
};

/** Remove os itens que não estão mais na origem (ex.: vídeo apagado da pasta do Drive). Devolve quantos saíram. */
export const pruneTelegramItems = (db: Database, channelId: string, keepMessageIds: string[]): number => {
  const keep = new Set(keepMessageIds);
  const stale = listTelegramItems(db, channelId).filter((i) => !keep.has(i.message_id));
  const remove = db.query('DELETE FROM telegram_items WHERE channel_id = ? AND message_id = ?');
  db.transaction(() => {
    for (const item of stale) remove.run(channelId, item.message_id);
  })();
  return stale.length;
};

export const getTelegramItem = (db: Database, channelId: string, messageId: string): TelegramItemRow | null =>
  db.query<TelegramItemRow, [string, string]>('SELECT * FROM telegram_items WHERE channel_id = ? AND message_id = ?').get(channelId, messageId);

export const listTelegramItems = (db: Database, channelId: string): TelegramItemRow[] =>
  db
    .query<TelegramItemRow, [string]>(
      'SELECT * FROM telegram_items WHERE channel_id = ? ORDER BY CAST(message_id AS INTEGER) ASC',
    )
    .all(channelId);

export interface RecentTelegramItem extends TelegramItemRow {
  channel_title: string;
  channel_handle: string;
}

/** Vídeos mais novos de todos os canais, para o feed do Início e do hub do Telegram. Sem data fica por último. */
export const listRecentTelegramItems = (db: Database, limit: number): RecentTelegramItem[] =>
  db
    .query<RecentTelegramItem, [number]>(
      `SELECT ti.*, t.title AS channel_title, tc.handle AS channel_handle
       FROM telegram_items ti
       JOIN telegram_channels tc ON tc.id = ti.channel_id
       JOIN titles t ON t.id = tc.id
       ORDER BY ti.posted_at IS NULL, ti.posted_at DESC, CAST(ti.message_id AS INTEGER) DESC
       LIMIT ?`,
    )
    .all(limit);

export interface TelegramChannelInfoPatch {
  title?: string | null;
  description?: string | null;
  posterPath?: string | null;
}

/** Campos ausentes (null/undefined) preservam o valor atual — uma falha parcial ao buscar não apaga o que já existe. */
export const updateTelegramChannelInfo = (db: Database, id: string, patch: TelegramChannelInfoPatch): void => {
  db.query("UPDATE titles SET title = COALESCE($title, title), overview = COALESCE($overview, overview), poster_path = COALESCE($poster, poster_path) WHERE id = $id AND source = 'telegram'").run({
    $id: id,
    $title: patch.title ?? null,
    $overview: patch.description ?? null,
    $poster: patch.posterPath ?? null,
  });
};

export const setTelegramItemThumbnail = (db: Database, channelId: string, messageId: string, url: string | null): void => {
  db.query("UPDATE telegram_items SET thumbnail_url = ? WHERE channel_id = ? AND message_id = ?").run(url, channelId, messageId);
};
