import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { backupRoutes } from '../src/server/routes/backup.ts';
import { playbackRoutes } from '../src/server/routes/playback.ts';
import { InvalidPlaybackError, PLAYBACK_MAX_ROWS, parsePlaybackEntry, upsertPlaybackEntry } from '../src/server/repo/playback.ts';

/** Relógio real: o servidor recusa `at` mais de 1 dia no futuro, então o fixture tem de ser "agora". */
const NOW = Date.now() - 60_000;
const meta = { title: 'Episódio 1', subtitle: 'Canal teste', poster: null, channelId: 'c1', messageId: '5', route: '/watch/c1/5' };
const body = (over: Record<string, unknown> = {}) => ({ seconds: 120, duration: 1400, at: NOW, meta, ...over });

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const put = (key: string, b: unknown) => playbackRoutes.request(`/${key}`, { method: 'PUT', body: JSON.stringify(b) });

describe('migração', () => {
  test('cria a tabela e reabrir o mesmo arquivo não falha nem apaga dados', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-playback-'));
    const file = join(dir, 'x.db');
    try {
      const first = openDb(file);
      upsertPlaybackEntry(first, parsePlaybackEntry('c1:5', body(), NOW));
      first.close();

      const second = openDb(file);
      const row = second.query<{ n: number }, []>('SELECT COUNT(*) as n FROM playback_positions').get();
      expect(row?.n).toBe(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validação (entrada hostil)', () => {
  test.each([
    ['barra no meio (caminho)', 'c1/5'],
    ['traversal', 'a..b'],
    ['espaço', 'c1 5'],
    ['vazia', ''],
    ['acima de 200 caracteres', 'k'.repeat(201)],
  ])('recusa chave: %s', (_label, key) => {
    expect(() => parsePlaybackEntry(key, body(), NOW)).toThrow(InvalidPlaybackError);
  });

  test('aceita as chaves reais do cliente (canal:mensagem e archive:id)', () => {
    expect(parsePlaybackEntry('c1:5', body(), NOW).key).toBe('c1:5');
    expect(parsePlaybackEntry('archive:some-film_1.2', body(), NOW).key).toBe('archive:some-film_1.2');
  });

  test.each([
    ['negativo', -1],
    ['string', '120'],
    ['acima do teto', 1_000_001],
    ['infinito', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('recusa seconds %s', (_label, seconds) => {
    expect(() => parsePlaybackEntry('c1:5', body({ seconds }), NOW)).toThrow(InvalidPlaybackError);
  });

  test('recusa at no futuro distante e at fracionário; aceita pequena folga de relógio', () => {
    expect(() => parsePlaybackEntry('c1:5', body({ at: NOW + 3 * 24 * 3600 * 1000 }), NOW)).toThrow(InvalidPlaybackError);
    expect(() => parsePlaybackEntry('c1:5', body({ at: 1.5 }), NOW)).toThrow(InvalidPlaybackError);
    expect(parsePlaybackEntry('c1:5', body({ at: NOW + 3600_000 }), NOW).at).toBe(NOW + 3600_000);
  });

  test('done aceita boolean ou 0/1 (formato do SQLite no backup) e recusa outros tipos', () => {
    expect(parsePlaybackEntry('c1:5', body({ done: 1 }), NOW).done).toBe(true);
    expect(parsePlaybackEntry('c1:5', body({ done: 0 }), NOW).done).toBe(false);
    expect(() => parsePlaybackEntry('c1:5', body({ done: 'sim' }), NOW)).toThrow(InvalidPlaybackError);
  });

  test('meta: só campos conhecidos, strings truncadas, rota externa descartada', () => {
    const parsed = parsePlaybackEntry(
      'c1:5',
      body({ meta: { ...meta, poster: 'p'.repeat(5000), route: '//evil.example/x', extra: 'lixo', title: 'T'.repeat(999) } }),
      NOW,
    );
    expect(parsed.meta?.title).toHaveLength(200);
    expect(parsed.meta?.poster).toHaveLength(1000);
    expect(parsed.meta?.route).toBeUndefined();
    expect(parsed.meta).not.toHaveProperty('extra');
  });

  test('meta gigante é recusado mesmo com cada campo dentro do limite (bytes em UTF-8 estouram 2 KB)', () => {
    const huge = { ...meta, title: '€'.repeat(300), subtitle: '€'.repeat(300), poster: 'a'.repeat(500), route: `/${'a'.repeat(299)}` };
    expect(() => parsePlaybackEntry('c1:5', body({ meta: huge }), NOW)).toThrow(InvalidPlaybackError);
  });

  test('meta sem canal/mensagem ou que não é objeto é recusado; meta ausente é aceito (sem cartão de continuar)', () => {
    expect(() => parsePlaybackEntry('c1:5', body({ meta: { title: 'x' } }), NOW)).toThrow(InvalidPlaybackError);
    expect(() => parsePlaybackEntry('c1:5', body({ meta: ['x'] }), NOW)).toThrow(InvalidPlaybackError);
    expect(parsePlaybackEntry('c1:5', body({ meta: undefined }), NOW).meta).toBeNull();
  });
});

describe('last-write-wins por at', () => {
  test('gravação mais antiga é ignorada e não regride a posição', () => {
    const db = openDb(':memory:');
    expect(upsertPlaybackEntry(db, parsePlaybackEntry('c1:5', body({ seconds: 600, at: NOW }), NOW))).toBe(true);
    expect(upsertPlaybackEntry(db, parsePlaybackEntry('c1:5', body({ seconds: 60, at: NOW - 1000 }), NOW))).toBe(false);
    const row = db.query<{ seconds: number }, []>('SELECT seconds FROM playback_positions').get();
    expect(row?.seconds).toBe(600);
  });

  test('gravação mais nova substitui e a de mesmo at é aplicada (idempotente)', () => {
    const db = openDb(':memory:');
    upsertPlaybackEntry(db, parsePlaybackEntry('c1:5', body({ seconds: 600, at: NOW }), NOW));
    expect(upsertPlaybackEntry(db, parsePlaybackEntry('c1:5', body({ seconds: 900, at: NOW + 10 }), NOW))).toBe(true);
    expect(upsertPlaybackEntry(db, parsePlaybackEntry('c1:5', body({ seconds: 900, at: NOW + 10 }), NOW))).toBe(true);
    const row = db.query<{ n: number; seconds: number }, []>('SELECT COUNT(*) as n, MAX(seconds) as seconds FROM playback_positions').get();
    expect(row).toEqual({ n: 1, seconds: 900 });
  });

  test('ao passar do teto descarta as posições mais antigas', () => {
    const db = openDb(':memory:');
    for (let i = 1; i <= PLAYBACK_MAX_ROWS + 1; i++) {
      upsertPlaybackEntry(db, parsePlaybackEntry(`c1:${i}`, body({ at: NOW + i }), NOW));
    }
    const count = db.query<{ n: number }, []>('SELECT COUNT(*) as n FROM playback_positions').get();
    expect(count?.n).toBe(PLAYBACK_MAX_ROWS);
    expect(db.query('SELECT 1 FROM playback_positions WHERE key = ?').get('c1:1')).toBeNull();
    expect(db.query('SELECT 1 FROM playback_positions WHERE key = ?').get(`c1:${PLAYBACK_MAX_ROWS + 1}`)).toBeTruthy();
  });

  test('gravação mais antiga que todas no teto não é "aplicada": ela some na hora e o cliente precisa saber', () => {
    const db = openDb(':memory:');
    for (let i = 1; i <= PLAYBACK_MAX_ROWS; i++) upsertPlaybackEntry(db, parsePlaybackEntry(`c1:${i}`, body({ at: NOW + i }), NOW));
    const applied = upsertPlaybackEntry(db, parsePlaybackEntry('velho:1', body({ at: NOW - 1000 }), NOW));
    expect(db.query('SELECT 1 FROM playback_positions WHERE key = ?').get('velho:1')).toBeNull();
    expect(applied).toBe(false);
  });
});

describe('/api/playback', () => {
  test('PUT grava e GET devolve com meta e done', async () => {
    const res = await put('c1:5', body({ done: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });

    const list = await (await playbackRoutes.request('/')).json();
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ key: 'c1:5', seconds: 120, duration: 1400, at: NOW, done: true, meta: { title: 'Episódio 1' } });
  });

  test('PUT mais antigo responde applied=false e não altera o registro', async () => {
    await put('c1:5', body({ seconds: 300, at: NOW }));
    expect(await (await put('c1:5', body({ seconds: 10, at: NOW - 5000 }))).json()).toEqual({ applied: false });
    const list = await (await playbackRoutes.request('/')).json();
    expect(list.entries[0].seconds).toBe(300);
  });

  test('chave hostil e corpo inválido dão 400 sem gravar nada', async () => {
    expect((await put('a..b', body())).status).toBe(400);
    expect((await put('c1:5', body({ seconds: -1 }))).status).toBe(400);
    expect((await playbackRoutes.request('/c1:5', { method: 'PUT', body: 'não é json' })).status).toBe(400);
    const list = await (await playbackRoutes.request('/')).json();
    expect(list.entries).toEqual([]);
  });

  test('corpo acima de 8 KB é recusado com 413 (não fica inteiro na memória)', async () => {
    const res = await playbackRoutes.request('/c1:5', { method: 'PUT', body: JSON.stringify({ ...body(), meta: { title: 'x'.repeat(9000) } }) });
    expect(res.status).toBe(413);
  });

  test('GET pagina com limit/offset, mais recentes primeiro', async () => {
    for (let i = 1; i <= 3; i++) await put(`c1:${i}`, body({ at: NOW + i }));
    const first = await (await playbackRoutes.request('/?limit=2')).json();
    expect(first.entries.map((e: { key: string }) => e.key)).toEqual(['c1:3', 'c1:2']);
    const second = await (await playbackRoutes.request('/?limit=2&offset=2')).json();
    expect(second.entries.map((e: { key: string }) => e.key)).toEqual(['c1:1']);
    const clamped = await (await playbackRoutes.request('/?limit=99999&offset=-4')).json();
    expect(clamped).toMatchObject({ limit: 500, offset: 0 });
  });

  test('DELETE remove a posição; chave inexistente responde deleted=false', async () => {
    await put('c1:5', body());
    expect(await (await playbackRoutes.request('/c1:5', { method: 'DELETE' })).json()).toEqual({ deleted: true });
    expect(await (await playbackRoutes.request('/c1:5', { method: 'DELETE' })).json()).toEqual({ deleted: false });
    expect((await playbackRoutes.request('/a..b', { method: 'DELETE' })).status).toBe(400);
  });
});

describe('backup: playbackPositions', () => {
  test('export inclui as posições e import restaura', async () => {
    const dbA = await getDb();
    upsertPlaybackEntry(dbA, parsePlaybackEntry('c1:5', body(), NOW));
    const dump = await (await backupRoutes.request('/')).json();
    expect(dump.playbackPositions).toHaveLength(1);
    expect(dump.playbackPositions[0]).toMatchObject({ key: 'c1:5', seconds: 120, meta: { channelId: 'c1' } });

    resetDbForTests(openDb(':memory:'));
    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
    expect(res.status).toBe(200);
    const restored = await (await playbackRoutes.request('/')).json();
    expect(restored.entries[0]).toMatchObject({ key: 'c1:5', seconds: 120 });
  });

  test('backup antigo, sem o campo, continua importando', async () => {
    const dump = await (await backupRoutes.request('/')).json();
    delete dump.playbackPositions;
    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
    expect(res.status).toBe(200);
  });

  test('import não regride uma posição mais nova que já está no banco', async () => {
    const db = await getDb();
    upsertPlaybackEntry(db, parsePlaybackEntry('c1:5', body({ seconds: 900, at: NOW + 100 }), NOW));
    const oldDump = { version: 1, exportedAt: 'x', titles: [], seasons: [], episodes: [], libraryEntries: [], playbackPositions: [{ key: 'c1:5', seconds: 30, duration: 1400, at: NOW, done: false, meta: null }] };
    expect((await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(oldDump) })).status).toBe(200);
    const row = db.query<{ seconds: number }, []>('SELECT seconds FROM playback_positions').get();
    expect(row?.seconds).toBe(900);
  });

  test('uma linha inválida recusa o backup inteiro antes de gravar qualquer coisa', async () => {
    const dump = { version: 1, exportedAt: 'x', titles: [{ id: 't9', source: 'tmdb', source_id: '9', media_type: 'movie', title: 'Não deve entrar', created_at: 'x' }], seasons: [], episodes: [], libraryEntries: [], playbackPositions: [{ key: 'c1/5', seconds: 1, at: NOW }] };
    const res = await backupRoutes.request('/import', { method: 'POST', body: JSON.stringify(dump) });
    expect(res.status).toBe(400);
    const db = await getDb();
    expect(db.query('SELECT 1 FROM titles WHERE id = ?').get('t9')).toBeNull();
  });
});
