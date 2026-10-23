import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { EVENTS_SQL, loadStatsInputs, SCOPE_CTE } from '../src/server/repo/stats.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, setCatalogStats, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';
import { buildSummary } from '../src/server/stats/summary.ts';
import { yearWindowUtc } from '../src/server/stats/time.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

/** Eventos sintéticos. `upsertLibraryEntry` grava o próprio histórico com o relógio real, então ele é apagado antes. */
const pending: Array<[string, string, string]> = [];
const event = (titleId: string, kind: string, at: string): void => {
  pending.push([titleId, kind, at]);
};
const flushEvents = (): void => {
  db.exec('DELETE FROM library_history');
  for (const [titleId, kind, at] of pending.splice(0)) {
    db.query('INSERT INTO library_history (id, title_id, kind, at, detail) VALUES (?, ?, ?, ?, NULL)').run(
      crypto.randomUUID(),
      titleId,
      kind,
      at,
    );
  }
};

const summaryFor = (year: number, tz = 'America/Sao_Paulo') =>
  buildSummary({ year, timeZone: tz, today: '2026-10-22', hoursPerDay: 1, ...loadStatsInputs(db, year) });

/** Biblioteca sintética: 2 assistidos, 2 na fila, 1 título que saiu da lista mas tem histórico. */
const seed = () => {
  const film = upsertTitle(db, { source: 'tmdb', sourceId: 'f1', mediaType: 'movie', title: 'Filme A' });
  setCatalogStats(db, film.id, { genres: ['Drama'], runtimeMinutes: 120 });
  upsertLibraryEntry(db, film.id, { watchStatus: 'watched', rating: 8 });
  event(film.id, 'added', '2026-01-05T12:00:00Z');
  event(film.id, 'finished', '2026-02-10T15:00:00Z');
  event(film.id, 'rewatch_started', '2026-06-01T12:00:00Z');
  event(film.id, 'finished', '2025-12-31T12:00:00Z'); // ano anterior: fora de 2026

  const series = upsertTitle(db, { source: 'tmdb', sourceId: 's1', mediaType: 'tv', title: 'Série B' });
  setCatalogStats(db, series.id, { genres: ['Comédia'], runtimeMinutes: 30 });
  const season = upsertSeason(db, series.id, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, season.id, [
    { episodeNumber: 1, name: 'e1', runtime: 30 },
    { episodeNumber: 2, name: 'e2', runtime: 40 },
    { episodeNumber: 3, name: 'e3', runtime: null },
  ]);
  upsertLibraryEntry(db, series.id, { watchStatus: 'watched', rating: 6 });
  event(series.id, 'finished', '2026-03-01T12:00:00Z');

  const unknownWant = upsertTitle(db, { source: 'tmdb', sourceId: 'w1', mediaType: 'movie', title: 'Filme C' });
  upsertLibraryEntry(db, unknownWant.id, { watchStatus: 'want' });

  const knownWant = upsertTitle(db, { source: 'tmdb', sourceId: 'w2', mediaType: 'movie', title: 'Filme D' });
  setCatalogStats(db, knownWant.id, { genres: null, runtimeMinutes: 90 });
  upsertLibraryEntry(db, knownWant.id, { watchStatus: 'want' });

  const removed = upsertTitle(db, { source: 'tmdb', sourceId: 'r1', mediaType: 'movie', title: 'Filme Removido' });
  setCatalogStats(db, removed.id, { genres: ['Terror'], runtimeMinutes: 100 });
  event(removed.id, 'finished', '2026-04-01T10:00:00Z');
  flushEvents();
};

describe('loadStatsInputs + buildSummary: biblioteca sintética ponta a ponta', () => {
  test('banco vazio: nada a mostrar, sem erro, sem divisão por zero', () => {
    const s = summaryFor(2026);
    expect(s.hasData).toBe(false);
    expect(s.library.total).toBe(0);
    expect(s.period.finished).toBe(0);
    expect(s.backlog).toMatchObject({ titles: 0, etaDate: null });
  });

  test('totais da biblioteca: status, tempo assistido e o que ficou de fora', () => {
    seed();
    const s = summaryFor(2026);
    expect(s.library.byStatus).toEqual({ want: 2, watching: 0, watched: 2, dropped: 0 });
    // 120 (filme) + 70 (série: 30 + 40; o episódio sem duração fica de fora)
    expect(s.library.watchTime).toEqual({ hours: 3.2, knownTitles: 2, missingTitles: 0, episodesWithoutRuntime: 1 });
  });

  test('fila: duração conhecida vira data; título sem duração fica contado à parte', () => {
    seed();
    const s = summaryFor(2026);
    expect(s.backlog).toEqual({
      titles: 2,
      hours: 1.5,
      missingTitles: 1,
      hoursPerDay: 1,
      etaDays: 2,
      etaDate: '2026-10-24',
    });
  });

  test('ano: conclusões e revisões, mas nada do ano anterior; título removido com histórico conta no período', () => {
    seed();
    const s = summaryFor(2026);
    expect(s.period.finished).toBe(3);
    expect(s.period.rewatches).toBe(1);
    expect(s.period.activeDays).toBe(5);
    expect(s.period.genres.top.map((g) => g.name)).toEqual(['Comédia', 'Drama', 'Terror']);
    expect(s.period.ratings).toMatchObject({ average: 7, rated: 2, unrated: 1 });
    expect(s.hasData).toBe(true);
  });

  test('o histórico sobrevive à remoção: o título removido não entra na biblioteca mas entra no ano', () => {
    seed();
    expect(summaryFor(2026).library.byStatus.watched).toBe(2);
    expect(summaryFor(2027).period.finished).toBe(0);
  });

  test('primeiro ano com histórico alimenta o seletor de ano; sem histórico, nulo', () => {
    expect(summaryFor(2026).firstYear).toBeNull();
    seed();
    expect(summaryFor(2026).firstYear).toBe(2025);
  });

  test('ano sem atividade: período vazio mesmo com biblioteca preenchida', () => {
    seed();
    const s = summaryFor(2020);
    expect(s.period.finished).toBe(0);
    expect(s.hasData).toBe(true);
  });
});

describe('índices: as consultas usam os índices que justificam a leitura por intervalo', () => {
  test('eventos por intervalo usam idx_library_history_at (não varrem o histórico todo)', () => {
    const { from, to } = yearWindowUtc(2026);
    const plan = db.query<{ detail: string }, [string, string]>(`EXPLAIN QUERY PLAN ${EVENTS_SQL}`).all(from, to);
    expect(plan.map((r) => r.detail).join(' | ')).toContain('idx_library_history_at');
  });

  test('escopo usa idx_library_status para a biblioteca e idx_library_history_at para as exibições do ano', () => {
    const { from, to } = yearWindowUtc(2026);
    const plan = db
      .query<{ detail: string }, { [k: string]: string }>(`EXPLAIN QUERY PLAN ${SCOPE_CTE} SELECT * FROM scope`)
      .all({ $from: from, $to: to });
    const text = plan.map((r) => r.detail).join(' | ');
    expect(text).toContain('idx_library_status');
    expect(text).toContain('idx_library_history_at');
  });
});
