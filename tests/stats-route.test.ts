import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { setCatalogStats, upsertTitle } from '../src/server/repo/titles.ts';
import { statsRoutes } from '../src/server/routes/stats.ts';

beforeEach(() => {
  const db = openDb(':memory:');
  resetDbForTests(db);
  const t = upsertTitle(db, { source: 'tmdb', sourceId: 'r1', mediaType: 'movie', title: 'Filme' });
  setCatalogStats(db, t.id, { genres: ['Drama'], runtimeMinutes: 100 });
  upsertLibraryEntry(db, t.id, { watchStatus: 'watched', rating: 7 });
  db.exec('DELETE FROM library_history'); // o upsert acima gravou eventos com o relógio real
  db.query('INSERT INTO library_history (id, title_id, kind, at, detail) VALUES (?, ?, ?, ?, NULL)').run(
    crypto.randomUUID(),
    t.id,
    'finished',
    '2026-07-04T12:00:00Z',
  );
});

describe('GET /api/stats', () => {
  test('devolve o resumo do ano no formato da tela', async () => {
    const res = await statsRoutes.request('/?year=2026&tz=America/Sao_Paulo&hpd=2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      year: 2026,
      timezone: 'America/Sao_Paulo',
      hasData: true,
      library: { byStatus: { watched: 1 }, watchTime: { hours: 1.7, knownTitles: 1 } },
      period: { finished: 1, activeDays: 1, ratings: { average: 7, rated: 1 } },
      backlog: { titles: 0, hoursPerDay: 2, etaDate: null },
    });
    expect(body.period.months).toHaveLength(12);
  });

  test('tz inválido ou ano fora da faixa: 400 com mensagem, sem consultar nada', async () => {
    const badTz = await statsRoutes.request('/?tz=Mars/Olympus');
    expect(badTz.status).toBe(400);
    expect((await badTz.json()).error).toContain('fuso');
    const badYear = await statsRoutes.request('/?year=1200');
    expect(badYear.status).toBe(400);
  });

  test('sem parâmetros usa UTC e o ano atual, com 200', async () => {
    const res = await statsRoutes.request('/');
    expect(res.status).toBe(200);
    expect((await res.json()).timezone).toBe('UTC');
  });
});
