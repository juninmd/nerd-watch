import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { unlinkSync } from 'node:fs';
import { migrateAddTelegramSource, openDb } from '../src/server/db.ts';

const OLD_SCHEMA = `
CREATE TABLE titles (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('tmdb', 'archive')),
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
CREATE TABLE library_entries (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL UNIQUE REFERENCES titles(id) ON DELETE CASCADE,
  watch_status TEXT NOT NULL CHECK (watch_status IN ('want', 'watching', 'watched', 'dropped')),
  rating INTEGER,
  notes TEXT,
  current_season INTEGER,
  current_episode INTEGER,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

describe('migrateAddTelegramSource', () => {
  test('preserva dados existentes, mantém a FK de library_entries e passa a aceitar source=telegram', () => {
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(OLD_SCHEMA);
    db.query(
      `INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t1', 'tmdb', '1', 'movie', 'Filme', '2026-01-01')`,
    ).run();
    db.query(
      `INSERT INTO library_entries (id, title_id, watch_status, added_at, updated_at) VALUES ('l1', 't1', 'want', '2026-01-01', '2026-01-01')`,
    ).run();

    migrateAddTelegramSource(db);

    const title = db.query<{ title: string }, [string]>('SELECT title FROM titles WHERE id = ?').get('t1');
    expect(title?.title).toBe('Filme');

    const libraryEntry = db.query<{ title_id: string }, [string]>('SELECT title_id FROM library_entries WHERE id = ?').get('l1');
    expect(libraryEntry?.title_id).toBe('t1');

    expect(() =>
      db
        .query(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t2', 'telegram', 'c1', 'tv', 'Canal', '2026-01-01')`)
        .run(),
    ).not.toThrow();

    // FK ainda ativa: título inexistente deve continuar sendo rejeitado.
    expect(() =>
      db
        .query(`INSERT INTO library_entries (id, title_id, watch_status, added_at, updated_at) VALUES ('l2', 'inexistente', 'want', '2026-01-01', '2026-01-01')`)
        .run(),
    ).toThrow();
  });

  test('é idempotente — rodar duas vezes não falha nem duplica dados', () => {
    const db = new Database(':memory:');
    db.exec(OLD_SCHEMA);
    db.query(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t1', 'tmdb', '1', 'movie', 'Filme', '2026-01-01')`).run();

    migrateAddTelegramSource(db);
    migrateAddTelegramSource(db);

    const count = db.query<{ n: number }, []>('SELECT COUNT(*) as n FROM titles').get();
    expect(count?.n).toBe(1);
  });
});

describe('openDb', () => {
  // Timeout maior: I/O em arquivo real (vs. :memory:) mede vários segundos nesta máquina (antivírus
  // escaneando o arquivo novo), sem relação com a lógica testada — já coberta rápido pelos testes acima.
  test('aplica a migração de ponta a ponta ao abrir um arquivo com schema antigo', () => {
    const path = `${import.meta.dir}/../.tmp-migration-test.db`;
    try {
      const legacy = new Database(path, { create: true });
      legacy.exec(OLD_SCHEMA);
      legacy
        .query(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t1', 'archive', 'x', 'movie', 'Domínio Público', '2026-01-01')`)
        .run();
      legacy.close();

      const db = openDb(path);
      const title = db.query<{ title: string }, [string]>('SELECT title FROM titles WHERE id = ?').get('t1');
      expect(title?.title).toBe('Domínio Público');
      expect(() =>
        db
          .query(`INSERT INTO titles (id, source, source_id, media_type, title, created_at) VALUES ('t2', 'telegram', 'c1', 'tv', 'Canal', '2026-01-01')`)
          .run(),
      ).not.toThrow();
      db.close();
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(`${path}${suffix}`);
        } catch {}
      }
    }
  }, 60_000);
});
