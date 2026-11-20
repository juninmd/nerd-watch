import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { upsertLibraryEntry } from '../../src/server/repo/library.ts';
import { upsertSeason, upsertTitle } from '../../src/server/repo/titles.ts';
import { upsertTelegramChannel, upsertTelegramItems } from '../../src/server/repo/telegram.ts';
import { backupRoutes } from '../../src/server/routes/backup.ts';

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
    expect(body.imported).toEqual({ titles: 1, seasons: 0, episodes: 0, libraryEntries: 1, libraryHistory: 1, lists: 0, savedViews: 0 });

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

  test('restaura canais e itens do Telegram', async () => {
    const dbA = await getDb();
    const ch = upsertTelegramChannel(dbA, { handle: 'nerd_test', mode: 'public' });
    upsertTelegramItems(dbA, ch.id, [{ messageId: '100', caption: 'Vídeo teste', durationSeconds: 60 }]);
    const dump = await (await backupRoutes.request('/')).json();
    expect(dump.telegramChannels).toHaveLength(1);
    expect(dump.telegramItems).toHaveLength(1);

    resetDbForTests(openDb(':memory:'));
    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
    expect(res.status).toBe(200);

    const dbB = await getDb();
    const restoredCh = dbB.query('SELECT * FROM telegram_channels WHERE id = ?').get(ch.id);
    expect(restoredCh).toBeTruthy();
    const restoredItem = dbB.query('SELECT * FROM telegram_items WHERE message_id = ?').get('100');
    expect(restoredItem).toBeTruthy();
  });

  test('preserva gêneros, duração, metadados de refresh e vínculos/tópicos de itens do Telegram', async () => {
    const dbA = await getDb();
    const title = upsertTitle(dbA, {
      source: 'tmdb',
      sourceId: '99',
      mediaType: 'tv',
      title: 'Série Rica',
    });
    dbA
      .query('UPDATE titles SET genres = ?, runtime_minutes = ?, metadata_status = ?, metadata_refreshed_at = ? WHERE id = ?')
      .run(JSON.stringify(['Drama', 'Ficção científica']), 52, 'Returning Series', '2026-05-01T12:00:00.000Z', title.id);

    const ch = upsertTelegramChannel(dbA, { handle: 'canal_links', mode: 'public' });
    upsertTelegramItems(dbA, ch.id, [{ messageId: '200', caption: 'S01E02', durationSeconds: 3000, topicId: '42' }]);
    dbA
      .query(
        `UPDATE telegram_items
         SET title_id = ?, season_number = 1, episode_number = 2, episode_end = 3,
             link_status = 'linked', link_source = 'manual', link_confidence = 1
         WHERE channel_id = ? AND message_id = '200'`,
      )
      .run(title.id, ch.id);

    const dump = await (await backupRoutes.request('/')).json();
    resetDbForTests(openDb(':memory:'));

    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
    expect(res.status).toBe(200);

    const dbB = await getDb();
    const restoredTitle = dbB
      .query<{ genres: string | null; runtime_minutes: number | null; metadata_status: string | null; metadata_refreshed_at: string | null }, [string]>(
        'SELECT genres, runtime_minutes, metadata_status, metadata_refreshed_at FROM titles WHERE id = ?',
      )
      .get(title.id);
    expect(restoredTitle).toEqual({
      genres: JSON.stringify(['Drama', 'Ficção científica']),
      runtime_minutes: 52,
      metadata_status: 'Returning Series',
      metadata_refreshed_at: '2026-05-01T12:00:00.000Z',
    });

    const restoredItem = dbB
      .query<
        {
          topic_id: string | null;
          title_id: string | null;
          season_number: number | null;
          episode_number: number | null;
          episode_end: number | null;
          link_status: string | null;
          link_source: string | null;
          link_confidence: number | null;
        },
        [string]
      >(
        'SELECT topic_id, title_id, season_number, episode_number, episode_end, link_status, link_source, link_confidence FROM telegram_items WHERE message_id = ?',
      )
      .get('200');
    expect(restoredItem).toEqual({
      topic_id: '42',
      title_id: title.id,
      season_number: 1,
      episode_number: 2,
      episode_end: 3,
      link_status: 'linked',
      link_source: 'manual',
      link_confidence: 1,
    });
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
