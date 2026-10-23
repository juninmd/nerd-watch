import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Api } from 'teleproto';
import { migrateAddTelegramItemMediaAttrs, openDb } from '../src/server/db.ts';
import { upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import * as personal from '../src/server/providers/telegram/personal.ts';
import { fetchPersonalVideoPage } from '../src/server/providers/telegram/personal.ts';
import { itemMediaDto } from '../src/server/telegram-item-dto.ts';

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** Mensagem de vídeo com os atributos MTProto dados (objetos reais de teleproto, sem rede). */
const videoMessage = (id: number, attributes: unknown[], mimeType = 'video/x-matroska') =>
  Object.assign(Object.create(Api.Message.prototype), {
    id,
    message: `legenda ${id}`,
    date: 1_790_000_000,
    media: Object.assign(Object.create(Api.MessageMediaDocument.prototype), {
      document: Object.assign(Object.create(Api.Document.prototype), { mimeType, attributes, thumbs: [] }),
    }),
  });

const withMessages = (messages: unknown[]) => {
  const client = { getMessages: async () => messages };
  spies.push(spyOn(personal, 'withLiveSession').mockImplementation(async (fn) => fn(client as never)));
};

describe('fetchPersonalVideoPage: atributos MTProto do vídeo', () => {
  test('lê largura, altura, streaming e nome original do arquivo', async () => {
    withMessages([
      videoMessage(5, [
        new Api.DocumentAttributeVideo({ duration: 61.4, w: 1920, h: 1080, supportsStreaming: true }),
        new Api.DocumentAttributeFilename({ fileName: 'Serie Teste S01E02.mkv' }),
      ]),
    ]);
    const { items } = await fetchPersonalVideoPage('canal_teste');
    expect(items).toEqual([
      expect.objectContaining({
        messageId: '5',
        durationSeconds: 61,
        width: 1920,
        height: 1080,
        supportsStreaming: true,
        fileName: 'Serie Teste S01E02.mkv',
      }),
    ]);
  });

  test('sem supportsStreaming no atributo: é falso (o Telegram omite a flag quando é falsa), não nulo', async () => {
    withMessages([videoMessage(6, [new Api.DocumentAttributeVideo({ duration: 10, w: 640, h: 480 })])]);
    const [item] = (await fetchPersonalVideoPage('canal_teste')).items;
    expect(item?.supportsStreaming).toBe(false);
  });

  test('vídeo sem atributo de vídeo nem nome: campos ficam nulos, não inventados', async () => {
    withMessages([videoMessage(7, [], 'video/mp4')]);
    const [item] = (await fetchPersonalVideoPage('canal_teste')).items;
    expect(item).toMatchObject({ width: null, height: null, supportsStreaming: null, fileName: null, durationSeconds: null });
  });

  test('nome de arquivo vazio conta como ausente', async () => {
    withMessages([videoMessage(8, [new Api.DocumentAttributeFilename({ fileName: '' })], 'video/mp4')]);
    const [item] = (await fetchPersonalVideoPage('canal_teste')).items;
    expect(item?.fileName).toBeNull();
  });
});

describe('persistência e DTO', () => {
  const missing = { width: null, height: null, supports_streaming: null, file_name: null };

  const freshChannel = () => {
    const db = openDb(':memory:');
    const channel = upsertTelegramChannel(db, { handle: 'canal_teste', mode: 'personal' });
    return { db, channel };
  };

  test('grava e lê os quatro campos; a DTO expõe streaming como booleano', () => {
    const { db, channel } = freshChannel();
    const rows = upsertTelegramItems(db, channel.id, [
      { messageId: '1', width: 1280, height: 720, supportsStreaming: true, fileName: 'a.mp4' },
      { messageId: '2', width: null, height: null, supportsStreaming: false, fileName: null },
      { messageId: '3' },
    ]);
    const byId = (id: string) => rows.find((r) => r.message_id === id);
    expect(itemMediaDto(byId('1') ?? missing)).toEqual({ width: 1280, height: 720, supportsStreaming: true, fileName: 'a.mp4' });
    expect(byId('2')).toMatchObject({ supports_streaming: 0, width: null });
    expect(itemMediaDto(byId('2') ?? missing).supportsStreaming).toBe(false);
    expect(byId('3')).toMatchObject({ supports_streaming: null, file_name: null });
    expect(itemMediaDto(byId('3') ?? missing).supportsStreaming).toBeNull();
  });

  test('reimportar a mesma mensagem atualiza os atributos (ex.: o Telegram passou a marcar streaming)', () => {
    const { db, channel } = freshChannel();
    upsertTelegramItems(db, channel.id, [{ messageId: '9', width: 640, height: 360, supportsStreaming: false }]);
    const rows = upsertTelegramItems(db, channel.id, [{ messageId: '9', width: 640, height: 360, supportsStreaming: true }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ supports_streaming: 1 });
  });
});

describe('migrateAddTelegramItemMediaAttrs', () => {
  const OLD_ITEMS = `
    CREATE TABLE telegram_channels (id TEXT PRIMARY KEY, mode TEXT NOT NULL, handle TEXT NOT NULL, cursor TEXT, created_at TEXT NOT NULL);
    CREATE TABLE telegram_items (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      caption TEXT,
      duration_seconds INTEGER,
      thumbnail_url TEXT,
      posted_at TEXT,
      file_ref TEXT,
      UNIQUE (channel_id, message_id)
    );
    INSERT INTO telegram_channels (id, mode, handle, created_at) VALUES ('c1', 'personal', 'canal', '2026-01-01');
    INSERT INTO telegram_items (id, channel_id, message_id, caption, duration_seconds) VALUES ('i1', 'c1', '10', 'Ep 1', 60);
  `;

  const columns = (db: Database) => db.query<{ name: string }, []>('PRAGMA table_info(telegram_items)').all().map((c) => c.name);

  test('adiciona as colunas sem perder linhas existentes', () => {
    const db = new Database(':memory:');
    db.exec(OLD_ITEMS);
    migrateAddTelegramItemMediaAttrs(db);
    expect(columns(db)).toEqual(expect.arrayContaining(['width', 'height', 'supports_streaming', 'file_name']));
    expect(db.query<{ caption: string; duration_seconds: number; width: number | null }, []>('SELECT caption, duration_seconds, width FROM telegram_items').get()).toEqual({
      caption: 'Ep 1',
      duration_seconds: 60,
      width: null,
    });
  });

  test('é idempotente e não toca em banco sem a tabela', () => {
    const db = new Database(':memory:');
    db.exec(OLD_ITEMS);
    migrateAddTelegramItemMediaAttrs(db);
    expect(() => migrateAddTelegramItemMediaAttrs(db)).not.toThrow();
    expect(columns(db).filter((c) => c === 'width')).toHaveLength(1);
    const empty = new Database(':memory:');
    expect(() => migrateAddTelegramItemMediaAttrs(empty)).not.toThrow();
  });
});
