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
    t.release_date as t_release_date, t.vote_average as t_vote_average, t.created_at as t_created_at
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

export const updateChannelCursor = (db: Database, channelId: string, cursor: string | null): void => {
  db.query('UPDATE telegram_channels SET cursor = $cursor WHERE id = $id').run({ $cursor: cursor, $id: channelId });
};

export interface NewTelegramItem {
  messageId: string;
  caption?: string | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  postedAt?: string | null;
  /** Referência específica do provider pra resolver o arquivo depois (ex: `file_id` da Bot API). Nulo no modo público, que resolve por scraping. */
  fileRef?: string | null;
}

export const upsertTelegramItems = (db: Database, channelId: string, items: NewTelegramItem[]): TelegramItemRow[] => {
  const insert = db.query(
    `INSERT INTO telegram_items (id, channel_id, message_id, caption, duration_seconds, thumbnail_url, posted_at, file_ref)
     VALUES ($id, $channelId, $messageId, $caption, $durationSeconds, $thumbnailUrl, $postedAt, $fileRef)
     ON CONFLICT (channel_id, message_id) DO UPDATE SET
       caption = excluded.caption, duration_seconds = excluded.duration_seconds,
       thumbnail_url = excluded.thumbnail_url, posted_at = excluded.posted_at, file_ref = excluded.file_ref`,
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
      });
    }
  });
  tx(items);
  return listTelegramItems(db, channelId);
};

export const getTelegramItem = (db: Database, channelId: string, messageId: string): TelegramItemRow | null =>
  db.query<TelegramItemRow, [string, string]>('SELECT * FROM telegram_items WHERE channel_id = ? AND message_id = ?').get(channelId, messageId);

export const listTelegramItems = (db: Database, channelId: string): TelegramItemRow[] =>
  db
    .query<TelegramItemRow, [string]>(
      'SELECT * FROM telegram_items WHERE channel_id = ? ORDER BY CAST(message_id AS INTEGER) ASC',
    )
    .all(channelId);
