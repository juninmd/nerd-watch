import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.ts';
import { addTitlesToList, createList } from '../src/server/repo/lists.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

const withDbFile = (run: (path: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'nerd-watch-lists-mig-'));
  try {
    run(join(dir, 'app.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const tables = (path: string): string[] => {
  const db = openDb(path);
  try {
    return db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  } finally {
    db.close();
  }
};

describe('migração das tabelas de listas e visões salvas', () => {
  test('é idempotente: abrir o mesmo banco várias vezes não falha nem apaga dados', () => {
    withDbFile((path) => {
      const first = openDb(path);
      const title = upsertTitle(first, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
      upsertLibraryEntry(first, title.id, { watchStatus: 'want' });
      const list = createList(first, { name: 'Favoritos', description: null });
      addTitlesToList(first, list.id, [title.id]);
      first.close();

      for (let i = 0; i < 3; i++) {
        const again = openDb(path);
        expect(again.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM list_items').get()?.n).toBe(1);
        expect(again.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM library_entries').get()?.n).toBe(1);
        again.close();
      }
    });
  });

  test('cria as tabelas num banco anterior (sem elas) sem tocar nas existentes', () => {
    withDbFile((path) => {
      const first = openDb(path);
      first.exec('DROP TABLE list_items; DROP TABLE lists; DROP TABLE saved_views;');
      first.close();
      // Conexão crua: openDb() recriaria as tabelas antes da checagem.
      const raw = new Database(path);
      expect(raw.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name = 'lists'").all()).toEqual([]);
      raw.close();

      expect(tables(path)).toEqual(expect.arrayContaining(['lists', 'list_items', 'saved_views', 'titles', 'library_entries']));
    });
  });

  test('a chave de list_items é (list_id, title_id): o mesmo título não entra duas vezes', () => {
    withDbFile((path) => {
      const db = openDb(path);
      const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
      const list = createList(db, { name: 'L', description: null });
      db.query('INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, 0, ?)').run(list.id, title.id, 'x');
      expect(() => db.query('INSERT INTO list_items (list_id, title_id, position, added_at) VALUES (?, ?, 1, ?)').run(list.id, title.id, 'x')).toThrow();
      db.close();
    });
  });
});
