import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { getTelegramChannelByHandle, listRecentTelegramItems, upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(':memory:');
  resetDbForTests(db);
});

describe('getTelegramChannelByHandle / upsertTelegramChannel — casing', () => {
  test('usernames do Telegram não diferenciam maiúsculas/minúsculas: busca com casing diferente acha o mesmo canal', () => {
    upsertTelegramChannel(db, { handle: 'MuhtesemYuzyil', mode: 'public' });

    const found = getTelegramChannelByHandle(db, 'muhtesemyuzyil');
    expect(found).not.toBeNull();
    expect(found?.handle).toBe('MuhtesemYuzyil');
  });

  test('regressão: adicionar de novo com casing diferente não cria um canal duplicado', () => {
    const first = upsertTelegramChannel(db, { handle: 'MeuCanal', mode: 'public' });
    const second = upsertTelegramChannel(db, { handle: 'meucanal', mode: 'public' });

    expect(second.id).toBe(first.id);
  });
});

describe('listRecentTelegramItems', () => {
  const seed = () => {
    const a = upsertTelegramChannel(db, { handle: 'canal_alfa', mode: 'public', displayName: 'Canal Alfa' });
    const b = upsertTelegramChannel(db, { handle: 'canal_beta', mode: 'public', displayName: 'Canal Beta' });
    upsertTelegramItems(db, a.id, [
      { messageId: '10', postedAt: '2026-01-01T10:00:00Z' },
      { messageId: '11', postedAt: '2026-01-03T10:00:00Z' },
    ]);
    upsertTelegramItems(db, b.id, [
      { messageId: '5', postedAt: '2026-01-02T10:00:00Z' },
      { messageId: '6', postedAt: null },
    ]);
  };

  test('ordena do mais novo para o mais antigo entre canais, com itens sem data por último', () => {
    seed();
    const items = listRecentTelegramItems(db, 10);
    expect(items.map((i) => `${i.channel_handle}:${i.message_id}`)).toEqual(['canal_alfa:11', 'canal_beta:5', 'canal_alfa:10', 'canal_beta:6']);
    expect(items[0]?.channel_title).toBe('Canal Alfa');
  });

  test('respeita o limite', () => {
    seed();
    expect(listRecentTelegramItems(db, 2)).toHaveLength(2);
  });

  test('sem canais devolve lista vazia', () => {
    expect(listRecentTelegramItems(db, 10)).toEqual([]);
  });
});
