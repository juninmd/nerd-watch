import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { rewatchLibraryEntry, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTitle } from '../src/server/repo/titles.ts';
import { backupRoutes } from '../src/server/routes/backup.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const exportDump = async () => (await backupRoutes.request('/')).json();
const importDump = (dump: unknown) => backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });

describe('backup do histórico e de rewatch_count', () => {
  test('exporta o histórico e o contador, e restaura ambos sem duplicar ao reimportar', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watched' });
    rewatchLibraryEntry(db, title.id);
    const dump = await exportDump();
    expect(dump.libraryHistory.map((h: { kind: string }) => h.kind).sort()).toEqual(['added', 'rewatch_started']);
    expect(dump.libraryEntries[0].rewatch_count).toBe(1);

    resetDbForTests(openDb(':memory:'));
    const res = await importDump(dump);
    expect(res.status).toBe(200);
    expect((await res.json()).imported.libraryHistory).toBe(2);

    const restored = await getDb();
    expect(restored.query<{ rewatch_count: number }, []>('SELECT rewatch_count FROM library_entries').get()?.rewatch_count).toBe(1);

    // Reimportar o mesmo backup não duplica eventos (ids preservados).
    await importDump(dump);
    expect(restored.query<{ n: number }, []>('SELECT COUNT(*) as n FROM library_history').get()?.n).toBe(2);
  });

  test('backup antigo (sem libraryHistory nem rewatch_count) continua importando', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watched', rating: 9 });
    const dump = await exportDump();
    delete dump.libraryHistory;
    for (const entry of dump.libraryEntries) delete entry.rewatch_count;

    resetDbForTests(openDb(':memory:'));
    const res = await importDump(dump);
    expect(res.status).toBe(200);
    expect((await res.json()).imported.libraryEntries).toBe(1);

    const restored = await getDb();
    const entry = restored.query<{ rewatch_count: number; rating: number }, []>('SELECT rewatch_count, rating FROM library_entries').get();
    expect(entry).toEqual({ rewatch_count: 0, rating: 9 });
  });

  test('libraryHistory com tipo desconhecido é rejeitado sem importar nada', async () => {
    const db = await getDb();
    upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
    const dump = await exportDump();
    dump.libraryHistory = [{ id: 'h1', title_id: 'x', kind: 'apagar-tudo', at: '2026-01-01T00:00:00.000Z', detail: null }];

    resetDbForTests(openDb(':memory:'));
    expect((await importDump(dump)).status).toBe(400);
    expect((await getDb()).query<{ n: number }, []>('SELECT COUNT(*) as n FROM titles').get()?.n).toBe(0);
  });

  test('rewatch_count inválido (texto, negativo ou fracionário) é rejeitado sem importar nada', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watched' });
    const good = await exportDump();

    for (const bad of ['3', -1, 1.5]) {
      const dump = structuredClone(good);
      dump.libraryEntries[0].rewatch_count = bad;
      resetDbForTests(openDb(':memory:'));
      expect((await importDump(dump)).status).toBe(400);
      expect((await getDb()).query<{ n: number }, []>('SELECT COUNT(*) as n FROM titles').get()?.n).toBe(0);
    }
  });

  test('histórico apontando para título inexistente falha a importação inteira (FK), sem importar nada', async () => {
    const db = await getDb();
    upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'movie', title: 'Filme' });
    const dump = await exportDump();
    dump.libraryHistory = [{ id: 'h-orfao', title_id: 'nao-existe', kind: 'added', at: '2026-01-01T00:00:00.000Z', detail: null }];

    resetDbForTests(openDb(':memory:'));
    expect((await importDump(dump)).status).toBe(400);
    expect((await getDb()).query<{ n: number }, []>('SELECT COUNT(*) as n FROM titles').get()?.n).toBe(0);
  });

  test('libraryHistory que não é lista é rejeitado', async () => {
    const dump = await exportDump();
    dump.libraryHistory = 'não é lista';
    expect((await importDump(dump)).status).toBe(400);
  });
});
