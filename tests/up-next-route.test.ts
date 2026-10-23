import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const seedWatchingSeries = () => {
  const db = openDb(':memory:');
  resetDbForTests(db);
  const title = upsertTitle(db, { source: 'tmdb', sourceId: '99', mediaType: 'tv', title: 'Série Fictícia', posterPath: '/p.jpg' });
  const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, season.id, [
    { episodeNumber: 1, name: 'Piloto' },
    { episodeNumber: 2, name: 'Segundo' },
  ]);
  upsertLibraryEntry(db, title.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
  return title;
};

describe('GET /api/library/up-next', () => {
  test('devolve o próximo episódio com o título e a temporada no formato da API', async () => {
    const title = seedWatchingSeries();
    const res = await libraryRoutes.request('/up-next');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      titleId: title.id,
      seasonNumber: 1,
      episodeNumber: 2,
      episodeName: 'Segundo',
      title: { title: 'Série Fictícia', source: 'tmdb', sourceId: '99', mediaType: 'tv' },
    });
    expect(body.items[0].title.posterUrl).toContain('/p.jpg');
  });

  test('aceita limit dentro de 1..50 e recusa o resto', async () => {
    seedWatchingSeries();
    expect((await libraryRoutes.request('/up-next?limit=1')).status).toBe(200);
    expect((await libraryRoutes.request('/up-next?limit=0')).status).toBe(400);
    expect((await libraryRoutes.request('/up-next?limit=51')).status).toBe(400);
    expect((await libraryRoutes.request('/up-next?limit=abc')).status).toBe(400);
  });

  test('biblioteca vazia devolve lista vazia, não erro', async () => {
    const body = await (await libraryRoutes.request('/up-next')).json();
    expect(body).toEqual({ items: [] });
  });
});
