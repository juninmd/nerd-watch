import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { computeStreaks, getLibraryStats } from '../src/server/repo/stats.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import { statsRoutes } from '../src/server/routes/stats.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

const history = (titleId: string, kind: string, at: string): void => {
  db.query('INSERT INTO library_history (id, title_id, kind, at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), titleId, kind, at);
};

describe('computeStreaks', () => {
  test('sequência atual vale se o último dia ativo é hoje ou ontem', () => {
    expect(computeStreaks(['2026-10-21', '2026-10-22'], '2026-10-23')).toEqual({ current: 2, longest: 2 });
    expect(computeStreaks(['2026-10-20'], '2026-10-23')).toEqual({ current: 0, longest: 1 });
  });
  test('maior sequência ignora duplicatas e lacunas', () => {
    expect(computeStreaks(['2026-10-01', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10'], '2026-10-23')).toEqual({ current: 0, longest: 3 });
  });
  test('sem atividade', () => {
    expect(computeStreaks([], '2026-10-23')).toEqual({ current: 0, longest: 0 });
  });
});

describe('getLibraryStats', () => {
  test('biblioteca vazia devolve zeros', () => {
    const s = getLibraryStats(db, '2026-10-23');
    expect(s.total).toBe(0);
    expect(s.averageRating).toBeNull();
    expect(s.ratings).toHaveLength(11);
    expect(s.finishedByMonth).toHaveLength(12);
    expect(s.finishedByMonth.at(-1)?.month).toBe('2026-10');
  });

  test('conta por status, tipo, nota e concluídos por mês', () => {
    const a = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'A' });
    const b = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'tv', title: 'B' });
    upsertLibraryEntry(db, a.id, { watchStatus: 'watched', rating: 9 });
    upsertLibraryEntry(db, b.id, { watchStatus: 'watching', rating: 7 });
    history(a.id, 'finished', '2026-10-22T10:00:00.000Z');
    history(a.id, 'added', '2026-09-01T10:00:00.000Z');
    history(a.id, 'added', '2024-01-01T10:00:00.000Z');

    const s = getLibraryStats(db, '2026-10-23');
    expect(s.total).toBe(2);
    expect(s.byStatus).toMatchObject({ watched: 1, watching: 1, want: 0 });
    expect(s.byType).toEqual({ movie: 1, tv: 1 });
    expect(s.ratings[9]).toBe(1);
    expect(s.averageRating).toBe(8);
    expect(s.finishedByMonth.at(-1)).toEqual({ month: '2026-10', count: 1 });
    const dates = s.activity.map((d) => d.date);
    expect(dates).toContain('2026-09-01');
    expect(dates).toContain('2026-10-22');
    expect(dates).not.toContain('2024-01-01');
    expect(s.streak.longest).toBeGreaterThanOrEqual(1);
    expect(s.topRated[0]?.title).toBe('A');
  });
});

describe('GET /api/stats', () => {
  test('responde com a URL do pôster resolvida', async () => {
    resetDbForTests(openDb(':memory:'));
    const conn = await getDb();
    const t = upsertTitle(conn, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'A', posterPath: '/x.jpg' });
    upsertLibraryEntry(conn, t.id, { watchStatus: 'watched', rating: 10 });
    const res = await statsRoutes.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topRated[0].posterUrl).toContain('https://image.tmdb.org');
    expect(body.topRated[0].posterPath).toBeUndefined();
  });
});
