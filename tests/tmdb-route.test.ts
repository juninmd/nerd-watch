import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { tmdbRoutes } from '../src/server/routes/tmdb.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

describe('GET /api/tmdb/:mediaType/:id', () => {
  test('rejeita mediaType/id inválidos', async () => {
    const res = await tmdbRoutes.request('/album/1');
    expect(res.status).toBe(400);
  });

  test('501 quando TMDB_API_KEY não está configurada (ambiente de teste)', async () => {
    const res = await tmdbRoutes.request('/movie/603');
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain('TMDB_API_KEY');
  });
});

describe('GET /api/tmdb/:mediaType/:id/season/:num', () => {
  test('rejeita mediaType "movie" (temporadas só existem para séries)', async () => {
    const res = await tmdbRoutes.request('/movie/603/season/1');
    expect(res.status).toBe(400);
  });

  test('501 quando TMDB_API_KEY não está configurada', async () => {
    const res = await tmdbRoutes.request('/tv/1399/season/1');
    expect(res.status).toBe(501);
  });
});
