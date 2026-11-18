import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Api } from 'teleproto';
import { migrateAddTelegramTopics } from '../../src/server/db/migrate-telegram-topics.ts';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { topicOf } from '../../src/server/providers/telegram/personal-item.ts';
import { getTelegramItem, upsertTelegramChannel, upsertTelegramItems } from '../../src/server/repo/telegram.ts';
import { getChannelMeta, replaceChannelMeta } from '../../src/server/repo/telegram-topics.ts';
import { telegramHistoryRoutes } from '../../src/server/routes/telegram-history.ts';

describe('topicOf', () => {
  test('resposta dentro do tópico usa replyToTopId; direto na abertura usa replyToMsgId', () => {
    expect(topicOf({ replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToTopId: 7, replyToMsgId: 9 }) })).toBe('7');
    expect(topicOf({ replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: 7 }) })).toBe('7');
  });
  test('resposta comum (fora de fórum) e mensagem sem resposta não têm tópico', () => {
    expect(topicOf({ replyTo: new Api.MessageReplyHeader({ replyToMsgId: 3 }) })).toBeNull();
    expect(topicOf({ replyTo: undefined })).toBeNull();
  });
});

describe('migração e repositório de tópicos', () => {
  test('migração é idempotente e acrescenta topic_id a uma tabela antiga', () => {
    const legacy = new Database(':memory:');
    legacy.exec('CREATE TABLE telegram_channels (id TEXT PRIMARY KEY)');
    legacy.exec('CREATE TABLE telegram_items (id TEXT PRIMARY KEY, channel_id TEXT, message_id TEXT)');
    migrateAddTelegramTopics(legacy);
    migrateAddTelegramTopics(legacy);
    const cols = legacy.query<{ name: string }, []>('PRAGMA table_info(telegram_items)').all().filter((c) => c.name === 'topic_id');
    expect(cols).toHaveLength(1);
  });

  test('guarda topic_id do vídeo e substitui tópicos/fixadas a cada sincronização', () => {
    const db = openDb(':memory:');
    const ch = upsertTelegramChannel(db, { handle: 'forum', mode: 'personal' });
    upsertTelegramItems(db, ch.id, [{ messageId: '5', caption: 'a', topicId: '10' }, { messageId: '6', caption: 'b' }]);
    expect(getTelegramItem(db, ch.id, '5')?.topic_id).toBe('10');
    expect(getTelegramItem(db, ch.id, '6')?.topic_id).toBeNull();
    // Reimportar sem tópico (ex.: busca) não apaga o que já se sabe.
    upsertTelegramItems(db, ch.id, [{ messageId: '5', caption: 'a' }]);
    expect(getTelegramItem(db, ch.id, '5')?.topic_id).toBe('10');

    expect(getChannelMeta(db, ch.id).syncedAt).toBeNull();
    replaceChannelMeta(db, ch.id, { topics: [{ topicId: '10', title: 'Anime', pinned: true }], pins: [{ messageId: '2', text: 'regras', postedAt: null }] });
    replaceChannelMeta(db, ch.id, { topics: [{ topicId: '11', title: 'Filmes', pinned: false }], pins: [] });
    const meta = getChannelMeta(db, ch.id);
    expect(meta.topics).toEqual([{ topicId: '11', title: 'Filmes', pinned: false }]);
    expect(meta.pins).toEqual([]);
    expect(meta.syncedAt).not.toBeNull();
  });
});

describe('POST /:id/sync-meta', () => {
  beforeEach(() => resetDbForTests(openDb(':memory:')));

  test('canal inexistente dá 404; modo público devolve vazio sem falar com o Telegram', async () => {
    expect((await telegramHistoryRoutes.request('/nope/sync-meta', { method: 'POST' })).status).toBe(404);
    const { getDb } = await import('../../src/server/db/database.ts');
    const ch = upsertTelegramChannel(await getDb(), { handle: 'pub', mode: 'public' });
    const res = await telegramHistoryRoutes.request(`/${ch.id}/sync-meta`, { method: 'POST' });
    expect(await res.json()).toEqual({ topics: [], pins: [], syncedAt: null });
  });
});
