import type { Database } from 'bun:sqlite';

export interface ChannelTopic {
  topicId: string;
  title: string;
  pinned: boolean;
}

export interface ChannelPin {
  messageId: string;
  text: string | null;
  postedAt: string | null;
}

export interface ChannelMeta {
  topics: ChannelTopic[];
  pins: ChannelPin[];
  syncedAt: string | null;
}

/** Troca tópicos e fixadas do canal pelo que o Telegram devolveu agora (numa transação: nunca fica meio gravado). */
export const replaceChannelMeta = (db: Database, channelId: string, meta: Pick<ChannelMeta, 'topics' | 'pins'>): void => {
  db.transaction(() => {
    db.query('DELETE FROM telegram_topics WHERE channel_id = ?').run(channelId);
    db.query('DELETE FROM telegram_pins WHERE channel_id = ?').run(channelId);
    const topic = db.query('INSERT INTO telegram_topics (channel_id, topic_id, title, pinned) VALUES (?, ?, ?, ?)');
    for (const t of meta.topics) topic.run(channelId, t.topicId, t.title, t.pinned ? 1 : 0);
    const pin = db.query('INSERT INTO telegram_pins (channel_id, message_id, text, posted_at) VALUES (?, ?, ?, ?)');
    for (const p of meta.pins) pin.run(channelId, p.messageId, p.text, p.postedAt);
    db.query('INSERT INTO telegram_channel_meta (channel_id, synced_at) VALUES (?, ?) ON CONFLICT (channel_id) DO UPDATE SET synced_at = excluded.synced_at').run(
      channelId,
      new Date().toISOString(),
    );
  })();
};

export const getChannelMeta = (db: Database, channelId: string): ChannelMeta => {
  const topics = db
    .query<{ topic_id: string; title: string; pinned: number }, [string]>('SELECT topic_id, title, pinned FROM telegram_topics WHERE channel_id = ? ORDER BY pinned DESC, CAST(topic_id AS INTEGER) ASC')
    .all(channelId)
    .map((r) => ({ topicId: r.topic_id, title: r.title, pinned: r.pinned === 1 }));
  const pins = db
    .query<{ message_id: string; text: string | null; posted_at: string | null }, [string]>('SELECT message_id, text, posted_at FROM telegram_pins WHERE channel_id = ? ORDER BY CAST(message_id AS INTEGER) DESC')
    .all(channelId)
    .map((r) => ({ messageId: r.message_id, text: r.text, postedAt: r.posted_at }));
  const synced = db.query<{ synced_at: string }, [string]>('SELECT synced_at FROM telegram_channel_meta WHERE channel_id = ?').get(channelId);
  return { topics, pins, syncedAt: synced?.synced_at ?? null };
};
