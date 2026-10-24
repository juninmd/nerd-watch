import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateAddTitleStats, openDb } from '../src/server/db.ts';

/** Titles como estavam antes de genres/runtime_minutes (já com as colunas de refresh). */
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
  metadata_status TEXT,
  metadata_refreshed_at TEXT,
  UNIQUE (source, source_id)
);
`;

const columns = (db: Database): string[] =>
  db
    .query<{ name: string }, []>('PRAGMA table_info(titles)')
    .all()
    .map((c) => c.name);

describe('migrateAddTitleStats', () => {
  test('banco novo nasce com genres e runtime_minutes nulos', () => {
    const db = openDb(':memory:');
    expect(columns(db)).toEqual(expect.arrayContaining(['genres', 'runtime_minutes']));
    db.exec(
      `INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('a', 'tmdb', '1', 'movie', 'F', 'now')`,
    );
    expect(
      db
        .query<{ genres: string | null; runtime_minutes: number | null }, []>(
          'SELECT genres, runtime_minutes FROM titles',
        )
        .get(),
    ).toEqual({
      genres: null,
      runtime_minutes: null,
    });
  });

  test('rodar de novo é no-op (idempotente), mesmo com dados gravados', () => {
    const db = openDb(':memory:');
    db.exec(
      `INSERT INTO titles (id, source, source_id, media_type, title, created_at, genres, runtime_minutes) VALUES ('a', 'tmdb', '1', 'movie', 'F', 'now', '["Drama"]', 95)`,
    );
    expect(() => migrateAddTitleStats(db)).not.toThrow();
    expect(
      db.query<{ genres: string; runtime_minutes: number }, []>('SELECT genres, runtime_minutes FROM titles').get(),
    ).toEqual({
      genres: '["Drama"]',
      runtime_minutes: 95,
    });
  });

  test('banco antigo ganha as colunas sem perder títulos, e reabrir não repete nada', () => {
    const path = join(tmpdir(), `nerd-watch-stats-migr-${crypto.randomUUID()}.db`);
    try {
      const legacy = new Database(path, { create: true });
      legacy.exec(LEGACY_TITLES);
      legacy.exec(
        `INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('keep', 'tmdb', '1399', 'tv', 'Série antiga', '2026-01-01T00:00:00Z')`,
      );
      legacy.close();

      const first = openDb(path);
      expect(columns(first)).toEqual(expect.arrayContaining(['genres', 'runtime_minutes']));
      expect(
        first.query<{ title: string; genres: string | null }, []>('SELECT title, genres FROM titles').all(),
      ).toEqual([{ title: 'Série antiga', genres: null }]);
      first.close();

      const second = openDb(path);
      expect(second.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM titles').get()?.n).toBe(1);
      second.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(`${path}${suffix}`);
        } catch {
          // arquivo ainda não criado (WAL/SHM)
        }
      }
    }
  });

  test('índice por data do histórico existe (usado pelas estatísticas por intervalo)', () => {
    const db = openDb(':memory:');
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'library_history'",
      )
      .all();
    expect(names.map((n) => n.name)).toContain('idx_library_history_at');
  });
});
