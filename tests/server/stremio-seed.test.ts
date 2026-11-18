import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { seedAddonsFromConfig } from '../../src/server/providers/stremio/seed.ts';
import { listAddons } from '../../src/server/repo/stremio-addons.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

/**
 * Semeadura por ambiente: é o caminho para usar um addon sem escrever o link (que pode ter token) no
 * repositório. O que se prova: instala o que é válido, é idempotente e uma falha não derruba o boot.
 */

const GOOD = 'https://addon.example.com/SEGREDO/manifest.json';
const BAD = 'https://outro.example.com/manifest.json';

const manifest = { id: 'org.example.seed', name: 'Addon semeado', version: '1.0.0', types: ['movie'], resources: ['stream'], catalogs: [] };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  setAddonFetch(async (url) => {
    calls.push(url);
    if (url === GOOD) return json(manifest);
    return json({}, 500);
  });
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
});

describe('seedAddonsFromConfig', () => {
  test('sem URL configurada não faz nada', async () => {
    expect(await seedAddonsFromConfig([])).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('instala o addon do ambiente uma vez só', async () => {
    expect(await seedAddonsFromConfig([GOOD])).toBe(1);
    const db = await getDb();
    expect(listAddons(db).map((a) => a.manifest.name)).toEqual(['Addon semeado']);
    expect(await seedAddonsFromConfig([GOOD])).toBe(0);
  });

  test('falha e link inválido não interrompem a semeadura nem o boot', async () => {
    expect(await seedAddonsFromConfig([BAD, 'http://localhost/manifest.json', GOOD])).toBe(1);
    expect((await getDb()).query('SELECT COUNT(*) AS n FROM stremio_addons').get()).toEqual({ n: 1 });
    // O addon que falhou foi tentado; o inválido nem chegou à rede.
    expect(calls).toEqual([BAD, GOOD]);
  });
});
