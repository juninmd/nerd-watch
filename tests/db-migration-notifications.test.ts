import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.ts';
import { markNotificationSent, sentKeys } from '../src/server/repo/notifications.ts';

const withFile = (run: (path: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'nerd-watch-notify-'));
  try {
    run(join(dir, 'test.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('tabela notifications_sent', () => {
  test('abrir o banco várias vezes é idempotente e preserva o que já foi enviado', () => {
    withFile((path) => {
      const first = openDb(path);
      markNotificationSent(first, 'episode:t1:S1E1:2026-10-22', '2026-10-22T10:00:00.000Z');
      first.close();

      // Simula restarts: cada openDb roda as migrações de novo.
      const second = openDb(path);
      const third = openDb(path);
      expect([...sentKeys(third, ['episode:t1:S1E1:2026-10-22'])]).toEqual(['episode:t1:S1E1:2026-10-22']);
      second.close();
      third.close();
    });
  });

  test('a tabela existe com a chave primária esperada', () => {
    withFile((path) => {
      openDb(path).close();
      const db = new Database(path);
      const columns = db.query<{ name: string; pk: number }, []>('PRAGMA table_info(notifications_sent)').all();
      expect(columns.filter((c) => c.pk === 1).map((c) => c.name)).toEqual(['key']);
      db.close();
    });
  });

  test('marcar a mesma chave duas vezes não falha nem duplica', () => {
    const db = openDb(':memory:');
    markNotificationSent(db, 'movie:m1:2026-10-22', '2026-10-22T10:00:00.000Z');
    markNotificationSent(db, 'movie:m1:2026-10-22', '2026-10-23T10:00:00.000Z');
    const count = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM notifications_sent').get();
    expect(count?.n).toBe(1);
  });

  test('sentKeys sem chaves não consulta nada e devolve vazio', () => {
    const db = openDb(':memory:');
    expect(sentKeys(db, []).size).toBe(0);
  });
});
