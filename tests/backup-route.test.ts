import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';
import { backupRoutes } from '../src/server/routes/backup.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

describe('GET /api/backup', () => {
  test('exporta títulos e entradas da biblioteca', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme Backup' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watched', rating: 9 });

    const res = await backupRoutes.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.titles).toHaveLength(1);
    expect(body.libraryEntries).toHaveLength(1);
    expect(body.libraryEntries[0].rating).toBe(9);
  });
});

describe('POST /api/backup/import', () => {
  test('restaura um backup exportado em um banco vazio, preservando os IDs', async () => {
    const dbA = await getDb();
    const title = upsertTitle(dbA, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme Backup' });
    upsertLibraryEntry(dbA, title.id, { watchStatus: 'watched', rating: 9 });
    const dump = await (await backupRoutes.request('/')).json();

    resetDbForTests(openDb(':memory:'));

    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toEqual({ titles: 1, seasons: 0, episodes: 0, libraryEntries: 1 });

    const dbB = await getDb();
    const restored = dbB.query('SELECT * FROM titles WHERE id = ?').get(title.id);
    expect(restored).toBeTruthy();
  });

  test('reimportar um backup antigo não apaga dados criados depois dele (regressão: INSERT OR REPLACE cascateava DELETE)', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'tv', title: 'Série Backup' });
    const oldDump = await (await backupRoutes.request('/')).json();

    const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'Temporada 1' });

    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(oldDump) });
    expect(res.status).toBe(200);

    const survivingSeason = db.query('SELECT * FROM seasons WHERE id = ?').get(season.id);
    expect(survivingSeason).toBeTruthy();
  });

  test('400 em JSON sem o formato esperado', async () => {
    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify({ nada: 'a ver' }) });
    expect(res.status).toBe(400);
  });

  test('400 em corpo que não é JSON válido', async () => {
    const res = await backupRoutes.request('/import', { method: 'POST', body: 'não é json' });
    expect(res.status).toBe(400);
  });
});
