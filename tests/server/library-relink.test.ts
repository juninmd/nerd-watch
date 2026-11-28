import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { getDb, openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../../src/server/repo/library.ts';
import { relinkLibraryEntry } from '../../src/server/repo/library-relink.ts';
import { upsertTitle } from '../../src/server/repo/titles.ts';
import { libraryRelinkRoutes } from '../../src/server/routes/library-relink.ts';

let db: Database;

beforeEach(async () => {
  resetDbForTests(openDb(':memory:'));
  db = await getDb();
});

const title = (sourceId: string, mediaType: 'movie' | 'tv' = 'tv') =>
  upsertTitle(db, { source: 'tmdb', sourceId, mediaType, title: `Título ${sourceId}` });

const historyCount = (titleId: string): number =>
  db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM library_history WHERE title_id = ?').get(titleId)?.n ?? 0;

describe('relinkLibraryEntry: "vínculo errado?"', () => {
  test('leva status, nota, marcador e histórico para o título certo', () => {
    const wrong = title('1');
    const right = title('2');
    upsertLibraryEntry(db, wrong.id, { watchStatus: 'watching', rating: 8, currentSeason: 2, currentEpisode: 4 });
    const before = historyCount(wrong.id);
    expect(relinkLibraryEntry(db, wrong.id, right.id)).toEqual({ ok: true });
    expect(getLibraryEntryByTitle(db, wrong.id)).toBeNull();
    expect(getLibraryEntryByTitle(db, right.id)).toMatchObject({ watch_status: 'watching', rating: 8, current_season: 2, current_episode: 4 });
    expect(historyCount(right.id)).toBe(before);
    expect(historyCount(wrong.id)).toBe(0);
  });

  test('indo para um filme, o marcador de episódio é zerado', () => {
    const wrong = title('1');
    const movie = title('3', 'movie');
    upsertLibraryEntry(db, wrong.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 2 });
    relinkLibraryEntry(db, wrong.id, movie.id);
    expect(getLibraryEntryByTitle(db, movie.id)).toMatchObject({ current_season: null, current_episode: null });
  });

  test('destino já na lista não junta nada (conflito); mesmo título e ausente são recusados', () => {
    const a = title('1');
    const b = title('2');
    upsertLibraryEntry(db, a.id, { watchStatus: 'want' });
    upsertLibraryEntry(db, b.id, { watchStatus: 'watched' });
    expect(relinkLibraryEntry(db, a.id, b.id)).toEqual({ ok: false, reason: 'conflict' });
    expect(getLibraryEntryByTitle(db, a.id)?.watch_status).toBe('want');
    expect(relinkLibraryEntry(db, a.id, a.id)).toEqual({ ok: false, reason: 'same' });
    expect(relinkLibraryEntry(db, title('9').id, b.id)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('POST /api/library/:titleId/relink', () => {
  const body = { source: 'tmdb', sourceId: '77', mediaType: 'tv', title: 'Série certa' };

  test('grava o título escolhido e devolve para onde navegar', async () => {
    const wrong = title('1');
    upsertLibraryEntry(db, wrong.id, { watchStatus: 'want' });
    const res = await libraryRelinkRoutes.request(`/${wrong.id}/relink`, { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: 'tmdb', sourceId: '77', mediaType: 'tv' });
  });

  test('corpo inválido é 400; título fora da lista é 404', async () => {
    const bad = await libraryRelinkRoutes.request('/x/relink', { method: 'POST', body: JSON.stringify({ title: 'só isso' }) });
    expect(bad.status).toBe(400);
    const missing = await libraryRelinkRoutes.request('/nao-existe/relink', { method: 'POST', body: JSON.stringify(body) });
    expect(missing.status).toBe(404);
  });
});
