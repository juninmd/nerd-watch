import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { getTelegramChannelByHandle, upsertTelegramChannel } from '../src/server/repo/telegram.ts';

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
