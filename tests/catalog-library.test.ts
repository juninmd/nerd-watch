import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const add = (body: Record<string, unknown>) =>
  libraryRoutes.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/library com fontes sem chave', () => {
  test('aceita tvmaze e anilist e devolve o pôster como URL completa', async () => {
    const res = await add({
      source: 'tvmaze',
      sourceId: '31',
      mediaType: 'tv',
      title: 'Série',
      posterPath: 'https://static.example.test/p.jpg',
    });
    expect(res.status).toBe(201);
    expect((await res.json()).title.posterUrl).toBe('https://static.example.test/p.jpg');

    const anime = await add({ source: 'anilist', sourceId: '21', mediaType: 'tv', title: 'Anime', posterPath: 'https://img.example.test/c.png' });
    expect(anime.status).toBe(201);
    expect((await anime.json()).title.posterUrl).toBe('https://img.example.test/c.png');
  });

  test('pôster que não é https é descartado: o servidor não guarda javascript: nem http', async () => {
    const bad = await add({ source: 'anilist', sourceId: '22', mediaType: 'tv', title: 'Anime', posterPath: 'javascript:alert(1)' });
    expect((await bad.json()).title.posterUrl).toBeNull();

    const http = await add({ source: 'tvmaze', sourceId: '32', mediaType: 'tv', title: 'Série', posterPath: 'http://insecure.example.test/p.jpg' });
    expect((await http.json()).title.posterUrl).toBeNull();
  });

  test('fonte fora da lista continua recusada com 400', async () => {
    const res = await add({ source: 'netflix', sourceId: '1', mediaType: 'tv', title: 'X' });
    expect(res.status).toBe(400);
  });

  test('tmdb mantém o comportamento de caminho relativo da TMDB', async () => {
    const res = await add({ source: 'tmdb', sourceId: '603', mediaType: 'movie', title: 'Matrix', posterPath: '/p.jpg' });
    expect((await res.json()).title.posterUrl).toBe('https://image.tmdb.org/t/p/w342/p.jpg');
  });
});
