import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import { getDescriptor, restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import { exportWatched, PartialExportError } from '../src/server/providers/trakt/export.ts';
import { registerTrakt } from '../src/server/providers/trakt/descriptor.ts';
import { traktRoutes } from '../src/server/routes/trakt.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';
import { connectEnv, disconnectEnv, type FakeCall, installFakeTrakt, movieWatched } from './trakt-harness.ts';

const registrySnapshot = snapshotRegistry();
let db: Database;

beforeAll(() => registerTrakt());
afterAll(() => restoreRegistry(registrySnapshot));

beforeEach(() => {
  db = openDb(':memory:');
  resetDbForTests(db);
  connectEnv();
});

afterEach(() => {
  disconnectEnv();
  resetDbForTests();
  db.close();
});

/** Marca um título TMDB como assistido no app (o que a exportação envia). */
const watched = (sourceId: string, mediaType: 'movie' | 'tv', source: 'tmdb' | 'archive' = 'tmdb') => {
  const title = upsertTitle(db, { source, sourceId, mediaType, title: `t ${sourceId}` });
  upsertLibraryEntry(db, title.id, { watchStatus: 'watched' });
};

const historyPosts = (calls: FakeCall[]) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/sync/history'));

describe('exportWatched: só o que falta no Trakt, sem duplicar', () => {
  test('envia apenas os assistidos com id TMDB que ainda não estão no histórico', async () => {
    const remote = { movies: [movieWatched(101)], shows: [] as unknown[] };
    const { calls } = installFakeTrakt(remote);
    watched('101', 'movie'); // já está no Trakt
    watched('102', 'movie'); // falta
    watched('202', 'tv'); // falta
    watched('900', 'movie', 'archive'); // origem sem TMDB

    const counts = await exportWatched(db, { pauseMs: 0 });

    expect(counts).toEqual({ exported: 2, alreadyInTrakt: 1, skippedNoTmdb: 1, notFound: 0 });
    expect(historyPosts(calls)).toHaveLength(1);
    expect(historyPosts(calls)[0]?.body).toEqual({ movies: [{ ids: { tmdb: 102 } }], shows: [{ ids: { tmdb: 202 } }] });
  });

  test('segunda execução não reenvia nada (o Trakt já tem tudo)', async () => {
    installFakeTrakt({ movies: [], shows: [] });
    watched('102', 'movie');
    await exportWatched(db, { pauseMs: 0 });

    const { calls } = installFakeTrakt({ movies: [movieWatched(102)], shows: [] });
    const again = await exportWatched(db, { pauseMs: 0 });

    expect(again).toEqual({ exported: 0, alreadyInTrakt: 1, skippedNoTmdb: 0, notFound: 0 });
    expect(historyPosts(calls)).toHaveLength(0);
  });

  test('envia em lotes do tamanho pedido e pausa entre eles', async () => {
    const { calls } = installFakeTrakt({ movies: [], shows: [] });
    for (const id of ['1', '2', '3']) watched(id, 'movie');

    const counts = await exportWatched(db, { batchSize: 2, pauseMs: 0 });

    expect(counts.exported).toBe(3);
    const bodies = historyPosts(calls).map((c) => ((c.body?.movies as unknown[] | undefined) ?? []).length);
    expect(bodies).toEqual([2, 1]);
  });

  test('id que o Trakt não reconhece é contado como não encontrado, não como exportado', async () => {
    installFakeTrakt({ movies: [], shows: [] }, { history: () => Response.json({ added: { movies: 1 }, not_found: { movies: [{ ids: { tmdb: 2 } }] } }) });
    watched('1', 'movie');
    watched('2', 'movie');

    const counts = await exportWatched(db, { batchSize: 10, pauseMs: 0 });

    expect(counts.notFound).toBe(1);
    expect(counts.exported).toBe(1);
  });

  test('429 no meio do export devolve as contagens até ali, com o tempo de espera e sem o corpo do Trakt', async () => {
    let posts = 0;
    installFakeTrakt(
      { movies: [], shows: [] },
      {
        history: () => {
          posts++;
          if (posts === 1) return Response.json({ added: { movies: 2 }, not_found: {} });
          return new Response('RAW-TRAKT-BODY-SHOULD-NOT-LEAK', { status: 429, headers: { 'Retry-After': '7' } });
        },
      },
    );
    for (const id of ['1', '2', '3']) watched(id, 'movie');

    const err = await exportWatched(db, { batchSize: 2, pauseMs: 0 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PartialExportError);
    const partial = err as PartialExportError;
    expect(partial.status).toBe(429);
    expect(partial.message).toContain('7s');
    expect(partial.message).not.toContain('RAW-TRAKT-BODY');
    expect(partial.counts).toEqual({ exported: 2, alreadyInTrakt: 0, skippedNoTmdb: 0, notFound: 0 });
  });
});

describe('POST /api/trakt/export: escreve na conta externa só com confirmação explícita', () => {
  test('sem { confirm: true } devolve 400 e não chama o Trakt', async () => {
    const { calls } = installFakeTrakt({ movies: [], shows: [] });
    watched('1', 'movie');

    const none = await traktRoutes.request('/export', { method: 'POST', body: JSON.stringify({}) });
    const str = await traktRoutes.request('/export', { method: 'POST', body: JSON.stringify({ confirm: 'true' }) });

    expect(none.status).toBe(400);
    expect(str.status).toBe(400);
    expect(calls.filter((c) => c.url.includes('api.trakt.tv'))).toHaveLength(0);
  });

  test('com confirmação, exporta e devolve as contagens', async () => {
    installFakeTrakt({ movies: [], shows: [] });
    watched('1', 'movie');

    const res = await traktRoutes.request('/export', { method: 'POST', body: JSON.stringify({ confirm: true }) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exported: 1, alreadyInTrakt: 0, skippedNoTmdb: 0, notFound: 0 });
  });

  test('429 vira 429 na rota, com o tempo de espera e as contagens parciais', async () => {
    installFakeTrakt({ movies: [], shows: [] }, { history: () => new Response('x', { status: 429, headers: { 'Retry-After': '30' } }) });
    watched('1', 'movie');

    const res = await traktRoutes.request('/export', { method: 'POST', body: JSON.stringify({ confirm: true }) });
    const body = (await res.json()) as { error: string; partial: unknown };

    expect(res.status).toBe(429);
    expect(body.error).toContain('30s');
    expect(body.partial).toEqual({ exported: 0, alreadyInTrakt: 0, skippedNoTmdb: 0, notFound: 0 });
  });
});

describe('rotas do Trakt: erros viram mensagens nossas, sem segredo nem corpo cru', () => {
  test('autorização expirada (invalid_grant) devolve 409 pedindo para reconectar', async () => {
    installFakeTrakt({ movies: [], shows: [] }, { tokenError: true });

    const res = await traktRoutes.request('/import', { method: 'POST' });
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toContain('conecte de novo');
  });

  test('sem conta conectada devolve 501 e não chama a API', async () => {
    const { calls } = installFakeTrakt({ movies: [], shows: [] });
    delete process.env.TRAKT_REFRESH_TOKEN;

    const res = await traktRoutes.request('/import', { method: 'POST' });

    expect(res.status).toBe(501);
    expect(calls.filter((c) => c.url.includes('api.trakt.tv'))).toHaveLength(0);
  });

  test('erro do Trakt com o segredo ecoado no corpo nunca vaza para a resposta', async () => {
    installFakeTrakt({ movies: [], shows: [] }, { history: () => new Response('echo fake-secret fake-access fake-refresh', { status: 500 }) });
    watched('1', 'movie');

    const res = await traktRoutes.request('/export', { method: 'POST', body: JSON.stringify({ confirm: true }) });
    const text = await res.text();

    expect(res.status).toBe(502);
    expect(text).not.toContain('fake-secret');
    expect(text).not.toContain('fake-access');
    expect(text).not.toContain('fake-refresh');
    expect(text).not.toContain('echo');
  });

  test('a lista de fontes expõe o client secret só como "set", nunca o valor', async () => {
    const res = await sourcesRoutes.request('/');
    const body = (await res.json()) as { sources: Array<{ id: string; fields: Array<{ key: string; secret: boolean; set: boolean; value: string }> }> };
    const trakt = body.sources.find((s) => s.id === 'trakt');
    const secret = trakt?.fields.find((f) => f.key === 'clientSecret');

    expect(getDescriptor('trakt')).toBeDefined();
    expect(secret).toMatchObject({ secret: true, set: true, value: '' });
    expect(JSON.stringify(body)).not.toContain('fake-secret');
  });
});
