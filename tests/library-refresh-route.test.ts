import { beforeEach, describe, expect, test } from 'bun:test';
import type { Hono } from 'hono';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { createCooldown } from '../src/server/metadata/cooldown.ts';
import { createLibraryRefreshRoutes } from '../src/server/routes/library-refresh.ts';
import { TmdbRequestError } from '../src/server/providers/tmdb.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import type { TitleRow } from '../src/server/types.ts';

const COOLDOWN_MS = 60_000;
const db = openDb(':memory:');
let clockMs = 0;
let refreshCalls: string[];
let failWith: unknown;
let routes: Hono;

/** Rota com provider falso (o refresh real, com rede, nunca roda nos testes) e cooldown novo a cada teste. */
const buildRoutes = () =>
  createLibraryRefreshRoutes({
    getDb: async () => db,
    refresh: async (_db, title: TitleRow) => {
      refreshCalls.push(title.id);
      if (failWith) throw failWith;
      return { seasons: 2, episodes: 16, refreshedAt: new Date(clockMs).toISOString() };
    },
    cooldown: createCooldown(COOLDOWN_MS, () => clockMs),
  });

const post = (titleId: string) => routes.request(`/${titleId}/refresh`, { method: 'POST' });

let showId: string;
let archiveId: string;

beforeEach(() => {
  resetDbForTests(db);
  db.exec('DELETE FROM library_entries; DELETE FROM titles;');
  clockMs = Date.parse('2026-10-22T12:00:00.000Z');
  refreshCalls = [];
  failWith = undefined;
  routes = buildRoutes();
  showId = upsertTitle(db, { source: 'tmdb', sourceId: '1399', mediaType: 'tv', title: 'Série' }).id;
  archiveId = upsertTitle(db, { source: 'archive', sourceId: 'x', mediaType: 'movie', title: 'Domínio público' }).id;
  upsertLibraryEntry(db, showId, { watchStatus: 'watching' });
});

describe('POST /api/library/:titleId/refresh', () => {
  test('título TMDB: atualiza e devolve o resumo', async () => {
    const res = await post(showId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ titleId: showId, seasons: 2, episodes: 16 });
    expect(refreshCalls).toEqual([showId]);
  });

  test('título inexistente: 404 sem chamar o provider', async () => {
    const res = await post('nao-existe');
    expect(res.status).toBe(404);
    expect(refreshCalls).toEqual([]);
  });

  test('título que não é da TMDB (domínio público): 400', async () => {
    const res = await post(archiveId);
    expect(res.status).toBe(400);
    expect(refreshCalls).toEqual([]);
  });

  test('segunda chamada dentro de 60 s: 429 com Retry-After, sem chamar o provider de novo', async () => {
    expect((await post(showId)).status).toBe(200);
    clockMs += 20_000;

    const res = await post(showId);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('40');
    expect((await res.json()).retryAfterSeconds).toBe(40);
    expect(refreshCalls).toHaveLength(1);
  });

  test('depois da janela de 60 s, a atualização volta a ser aceita', async () => {
    await post(showId);
    clockMs += COOLDOWN_MS;
    expect((await post(showId)).status).toBe(200);
    expect(refreshCalls).toHaveLength(2);
  });

  test('o cooldown é por título: outro título não espera', async () => {
    const otherId = upsertTitle(db, { source: 'tmdb', sourceId: '1400', mediaType: 'tv', title: 'Outra' }).id;
    await post(showId);
    expect((await post(otherId)).status).toBe(200);
  });

  test('falha do provider conta para o cooldown (não dá para martelar a TMDB com erro)', async () => {
    failWith = new TmdbRequestError(503, 'TMDB /tv/1399 respondeu 503');
    const first = await post(showId);
    expect(first.status).toBe(502);
    expect((await post(showId)).status).toBe(429);
    expect(refreshCalls).toHaveLength(1);
  });

  test('erro 404 da TMDB vira 404 para o cliente', async () => {
    failWith = new TmdbRequestError(404, 'TMDB /tv/1399 respondeu 404');
    expect((await post(showId)).status).toBe(404);
  });

  test('erro inesperado vira 500 com mensagem genérica, sem derrubar o servidor', async () => {
    failWith = new Error('explodiu');
    const res = await post(showId);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('falha ao atualizar metadados');
  });
});

describe('createCooldown', () => {
  test('tryAcquire libera a primeira chamada e informa os segundos restantes', () => {
    let t = 1_000;
    const cooldown = createCooldown(10_000, () => t);
    expect(cooldown.tryAcquire('a')).toEqual({ ok: true });
    t += 2_500;
    expect(cooldown.tryAcquire('a')).toEqual({ ok: false, retryAfterSec: 8 });
    t += 7_500;
    expect(cooldown.tryAcquire('a')).toEqual({ ok: true });
  });
});
