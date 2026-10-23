import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

/** Banco de um deploy anterior: sem `rewatch_count` nem `library_history`. Usa arquivo temporário fora do repo. */
const withLegacyDb = (run: (path: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'nerd-watch-mig-'));
  try {
    run(join(dir, 'legacy.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const columns = (db: Database, table: string): string[] =>
  (db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('migração do histórico de biblioteca', () => {
  test('adiciona rewatch_count com default 0 e preserva as entradas existentes', () => {
    withLegacyDb((path) => {
      const first = openDb(path);
      const title = upsertTitle(first, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Antigo' });
      upsertLibraryEntry(first, title.id, { watchStatus: 'watched', rating: 7 });
      first.exec('ALTER TABLE library_entries DROP COLUMN rewatch_count; DROP TABLE library_history;');
      first.close();

      const migrated = openDb(path);
      expect(columns(migrated, 'library_entries')).toContain('rewatch_count');
      const row = migrated.query<{ rewatch_count: number; rating: number; watch_status: string }, []>(
        'SELECT rewatch_count, rating, watch_status FROM library_entries',
      ).get();
      expect(row).toEqual({ rewatch_count: 0, rating: 7, watch_status: 'watched' });
      expect(columns(migrated, 'library_history')).toEqual(['id', 'title_id', 'kind', 'at', 'detail']);
      migrated.close();
    });
  });

  test('é idempotente: abrir o mesmo banco várias vezes não falha nem duplica colunas ou dados', () => {
    withLegacyDb((path) => {
      const first = openDb(path);
      const title = upsertTitle(first, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
      upsertLibraryEntry(first, title.id, { watchStatus: 'watching' });
      first.close();

      for (let i = 0; i < 3; i++) openDb(path).close();

      const db = openDb(path);
      expect(columns(db, 'library_entries').filter((c) => c === 'rewatch_count')).toHaveLength(1);
      const history = db.query<{ n: number }, []>('SELECT COUNT(*) as n FROM library_history').get();
      expect(history?.n).toBe(1);
      db.close();
    });
  });
});
