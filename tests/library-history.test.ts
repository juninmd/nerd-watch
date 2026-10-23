import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { bulkLibraryAction, getLibraryEntryByTitle, removeLibraryEntry, rewatchLibraryEntry, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { listLibraryHistory } from '../src/server/repo/library-history.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

const seed = (sourceId = '42') => upsertTitle(db, { source: 'tmdb', sourceId, mediaType: 'tv', title: 'Série Teste' });

/** Kinds em ordem cronológica (a consulta devolve do mais novo para o mais antigo). */
const chronological = (titleId: string): string[] =>
  listLibraryHistory(db, titleId, { limit: 100, offset: 0 })
    .items.map((r) => r.kind)
    .reverse();

describe('histórico de transições', () => {
  test('registra "added" na criação da entrada', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    expect(chronological(t.id)).toEqual(['added']);
  });

  test('registra cada transição de status com o tipo certo', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'dropped' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    expect(chronological(t.id)).toEqual(['added', 'started', 'finished', 'dropped', 'status_changed']);
  });

  test('update idempotente (mesmo status, nota ou rating) não gera linha duplicada', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching', rating: 8, notes: 'bom' });
    expect(chronological(t.id)).toEqual(['added', 'started']);
  });

  test('rating e notas nunca entram no histórico', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    upsertLibraryEntry(db, t.id, { rating: 9, notes: 'anotação' });
    expect(chronological(t.id)).toEqual(['added']);
  });

  test('progresso registra uma linha por mudança de temporada/episódio', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 3 });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 3 });
    const progress = listLibraryHistory(db, t.id, { limit: 10, offset: 0 }).items.filter((r) => r.kind === 'progress');
    expect(progress).toHaveLength(1);
    expect(progress[0]?.detail).toBe('T1 E3');
  });
});

describe('rewatch', () => {
  test('só é permitido a partir de assistido: nada muda e nada é registrado', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    const before = chronological(t.id);
    expect(rewatchLibraryEntry(db, t.id)).toEqual({ ok: false, reason: 'not_finished' });
    expect(chronological(t.id)).toEqual(before);
    expect(getLibraryEntryByTitle(db, t.id)?.rewatch_count).toBe(0);
  });

  test('título sem entrada devolve not_found', () => {
    const t = seed();
    expect(rewatchLibraryEntry(db, t.id)).toEqual({ ok: false, reason: 'not_found' });
  });

  test('a partir de assistido: volta a assistindo, incrementa rewatch_count e registra rewatch_started', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    const outcome = rewatchLibraryEntry(db, t.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.item.watch_status).toBe('watching');
    expect(outcome.item.rewatch_count).toBe(1);
    expect(chronological(t.id)).toEqual(['added', 'rewatch_started']);
  });

  test('rewatch não é permitido de novo até terminar a revisão (volta a ser assistido)', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    rewatchLibraryEntry(db, t.id);
    expect(rewatchLibraryEntry(db, t.id)).toEqual({ ok: false, reason: 'not_finished' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    expect(rewatchLibraryEntry(db, t.id)).toMatchObject({ ok: true });
    expect(getLibraryEntryByTitle(db, t.id)?.rewatch_count).toBe(2);
  });
});

describe('listLibraryHistory', () => {
  test('pagina do mais novo para o mais antigo, com total', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'watching' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'dropped' });
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });

    const firstPage = listLibraryHistory(db, t.id, { limit: 2, offset: 0 });
    expect(firstPage.total).toBe(4);
    expect(firstPage.items.map((r) => r.kind)).toEqual(['status_changed', 'dropped']);

    const lastPage = listLibraryHistory(db, t.id, { limit: 2, offset: 2 });
    expect(lastPage.items.map((r) => r.kind)).toEqual(['finished', 'added']);
  });

  test('offset além do fim devolve página vazia sem erro', () => {
    const t = seed();
    upsertLibraryEntry(db, t.id, { watchStatus: 'want' });
    expect(listLibraryHistory(db, t.id, { limit: 20, offset: 50 })).toEqual({ items: [], total: 1, limit: 20, offset: 50 });
  });

  test('título sem histórico devolve lista vazia', () => {
    expect(listLibraryHistory(db, seed().id, { limit: 20, offset: 0 }).total).toBe(0);
  });
});

describe('ciclo de vida', () => {
  test('o histórico sobrevive à remoção da entrada da lista', () => {
    const t = seed();
    const entry = upsertLibraryEntry(db, t.id, { watchStatus: 'watched' });
    removeLibraryEntry(db, entry.id);
    expect(chronological(t.id)).toEqual(['added']);
  });
});

describe('ação em lote', () => {
  test('registra o histórico só de quem realmente mudou de status', () => {
    const a = upsertTitle(db, { source: 'tmdb', sourceId: 'a', mediaType: 'movie', title: 'A' });
    const b = upsertTitle(db, { source: 'tmdb', sourceId: 'b', mediaType: 'movie', title: 'B' });
    upsertLibraryEntry(db, a.id, { watchStatus: 'watched' });
    upsertLibraryEntry(db, b.id, { watchStatus: 'want' });

    bulkLibraryAction(db, [a.id, b.id], { type: 'status', watchStatus: 'watched' });

    expect(chronological(a.id)).toEqual(['added']);
    expect(chronological(b.id)).toEqual(['added', 'finished']);
  });
});
