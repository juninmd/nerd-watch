import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

let titleId: string;
let movieId: string;

beforeEach(() => {
  const db = openDb(':memory:');
  resetDbForTests(db);
  const series = upsertTitle(db, { source: 'tmdb', sourceId: '700', mediaType: 'tv', title: 'Série Teste' });
  titleId = series.id;
  const s0 = upsertSeason(db, titleId, { seasonNumber: 0, name: 'Especiais' });
  replaceEpisodes(db, s0.id, [{ episodeNumber: 1, name: 'Especial 1' }]);
  const s1 = upsertSeason(db, titleId, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, s1.id, [
    { episodeNumber: 1, name: 'A' },
    { episodeNumber: 2, name: 'B' },
    { episodeNumber: 3, name: 'C' },
  ]);
  movieId = upsertTitle(db, { source: 'tmdb', sourceId: '701', mediaType: 'movie', title: 'Filme' }).id;
});

const post = (id: string, body: unknown) =>
  libraryRoutes.request(`/${id}/progress`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('POST /api/library/:titleId/progress: validação', () => {
  test.each([
    ['temporada não numérica', { seasonNumber: '1', episodeNumber: 1 }],
    ['temporada negativa', { seasonNumber: -1, episodeNumber: 1 }],
    ['temporada fracionária', { seasonNumber: 1.5, episodeNumber: 1 }],
    ['temporada acima do teto', { seasonNumber: 1000, episodeNumber: 1 }],
    ['episódio zero', { seasonNumber: 1, episodeNumber: 0 }],
    ['episódio sem campo', { seasonNumber: 1 }],
    ['episódio acima do teto', { seasonNumber: 1, episodeNumber: 10000 }],
  ])('recusa %s com 400', async (_label, body) => {
    expect((await post(titleId, body)).status).toBe(400);
  });

  test('corpo que não é JSON vira 400, não 500', async () => {
    expect((await post(titleId, '{não é json')).status).toBe(400);
  });

  test('título desconhecido: 404 e nada gravado', async () => {
    const res = await post('nao-existe', { seasonNumber: 1, episodeNumber: 1 });
    expect(res.status).toBe(404);
    expect((await (await libraryRoutes.request('/')).json()).items).toHaveLength(0);
  });

  test('episódio fora da temporada cacheada: 404', async () => {
    expect((await post(titleId, { seasonNumber: 1, episodeNumber: 9 })).status).toBe(404);
  });

  test('filme não aceita marcação por temporada: 400', async () => {
    expect((await post(movieId, { seasonNumber: 1, episodeNumber: 1 })).status).toBe(400);
  });
});

describe('POST /api/library/:titleId/progress: efeito', () => {
  test('marca e devolve o estado anterior e o item atualizado', async () => {
    const first = await (await post(titleId, { seasonNumber: 1, episodeNumber: 2 })).json();
    expect(first).toMatchObject({ changed: true, previous: null, item: { titleId, watchStatus: 'watching', currentSeason: 1, currentEpisode: 2 } });

    const second = await (await post(titleId, { seasonNumber: 1, episodeNumber: 3 })).json();
    expect(second.changed).toBe(true);
    expect(second.previous).toEqual({ watchStatus: 'watching', currentSeason: 1, currentEpisode: 2 });
  });

  test('primeiro episódio (S1E1) e especial (S0E1) são aceitos', async () => {
    expect((await (await post(titleId, { seasonNumber: 1, episodeNumber: 1 })).json()).item.currentEpisode).toBe(1);
    expect((await (await post(titleId, { seasonNumber: 0, episodeNumber: 1 })).json()).item.currentSeason).toBe(0);
  });

  test('duplo clique: duas requisições simultâneas gravam uma vez só', async () => {
    const [a, b] = await Promise.all([post(titleId, { seasonNumber: 1, episodeNumber: 3 }), post(titleId, { seasonNumber: 1, episodeNumber: 3 })]);
    const results = [await a.json(), await b.json()];
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(results.filter((r) => !r.changed)).toHaveLength(1);
  });
});
