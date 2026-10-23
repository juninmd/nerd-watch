import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.ts';

/** Titles como estavam antes do refresh de metadados (CHECK já com as fontes de catálogo, sem as colunas novas). */
const LEGACY_TITLES = `
CREATE TABLE titles (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('tmdb', 'archive', 'telegram', 'tvmaze', 'anilist')),
  source_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title TEXT NOT NULL,
  original_title TEXT,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  release_date TEXT,
  vote_average REAL,
  created_at TEXT NOT NULL,
  UNIQUE (source, source_id)
);
`;

const columnsOf = (db: Database): string[] => db.query<{ name: string }, []>('PRAGMA table_info(titles)').all().map((c) => c.name);

describe('migração das colunas de refresh em titles', () => {
  test('banco novo já nasce com metadata_status e metadata_refreshed_at (nulas)', () => {
    const db = openDb(':memory:');
    expect(columnsOf(db)).toEqual(expect.arrayContaining(['metadata_status', 'metadata_refreshed_at']));
    db.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('a', 'tmdb', '1', 'tv', 'T', 'now')`);
    const row = db.query<{ metadata_refreshed_at: string | null }, []>('SELECT metadata_refreshed_at FROM titles').get();
    expect(row?.metadata_refreshed_at).toBeNull();
  });

  test('banco antigo ganha as colunas sem perder títulos e continua idempotente', () => {
    const path = join(tmpdir(), `nerd-watch-migr-${crypto.randomUUID()}.db`);
    try {
      const legacy = new Database(path, { create: true });
      legacy.exec(LEGACY_TITLES);
      legacy.exec(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('keep', 'tmdb', '1399', 'tv', 'Série antiga', '2026-01-01T00:00:00Z')`);
      legacy.close();

      const first = openDb(path);
      expect(columnsOf(first)).toEqual(expect.arrayContaining(['metadata_status', 'metadata_refreshed_at']));
      expect(first.query<{ title: string }, []>('SELECT title FROM titles').all()).toEqual([{ title: 'Série antiga' }]);
      first.close();

      const second = openDb(path);
      expect(second.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n).toBe(1);
      second.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(`${path}${suffix}`);
        } catch {
          // arquivo já removido ou ainda não criado (WAL/SHM)
        }
      }
    }
  });
});
