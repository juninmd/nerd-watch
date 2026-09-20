import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { calendarRoutes } from '../src/server/routes/calendar.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe('GET /api/calendar', () => {
  test('lista episódio de um título rastreado com URL de poster já resolvida', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'tv', title: 'Série', posterPath: '/x.jpg' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watching' });
    const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
    replaceEpisodes(db, season.id, [{ episodeNumber: 1, name: 'Ep', overview: '', airDate: tomorrow() }]);

    const res = await calendarRoutes.request('/?days=30');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(30);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].posterUrl).toContain('https://image.tmdb.org');
  });

  test('ignora "days" inválido e cai no padrão de 60', async () => {
    const res = await calendarRoutes.request('/?days=9999');
    const body = await res.json();
    expect(body.days).toBe(60);
  });
});
