import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { parseManifest } from '../../src/server/providers/stremio/protocol.ts';
import { servesStreams } from '../../src/server/providers/stremio/title-streams.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import type { InstalledAddon } from '../../src/server/repo/stremio-addons.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

/**
 * Campos do manifest que o app descartava: `background`, `idPrefixes` e os `behaviorHints` de
 * configuração. O `idPrefixes` importa para não gastar requisição num addon que só entende `kitsu:`.
 */

const MANIFEST_URL = 'https://addon.example.com/TOKEN/manifest.json';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const baseManifest = {
  id: 'org.example.manifest',
  name: 'Addon completo',
  version: '3.1.0',
  description: 'desc',
  types: ['movie', 'series'],
  resources: [{ name: 'stream', types: ['movie', 'series'] }],
  catalogs: [],
  background: 'https://img.example.com/bg.jpg',
  logo: 'https://img.example.com/logo.png',
  idPrefixes: ['tt', 'kitsu:', 'tt'],
  behaviorHints: { configurable: true, configurationRequired: false },
};

const addonWith = (manifest: ReturnType<typeof parseManifest>): InstalledAddon => ({
  id: 'a1',
  manifestUrl: MANIFEST_URL,
  baseUrl: 'https://addon.example.com/TOKEN',
  manifest,
  addedAt: '2026-01-01T00:00:00.000Z',
  enabled: true,
});

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  setAddonFetch(async (url) => (url === MANIFEST_URL ? json(baseManifest) : json({}, 404)));
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
});

describe('manifest completo', () => {
  test('lê background, idPrefixes (sem repetir) e as flags de configuração', () => {
    const parsed = parseManifest(baseManifest);
    expect(parsed.background).toBe('https://img.example.com/bg.jpg');
    expect(parsed.idPrefixes).toEqual(['tt', 'kitsu:']);
    expect(parsed.configurable).toBe(true);
    expect(parsed.configurationRequired).toBe(false);
  });

  test('background não-http e flags que não são true ficam de fora', () => {
    const parsed = parseManifest({ ...baseManifest, background: 'javascript:alert(1)', behaviorHints: { configurable: 'yes', configurationRequired: 1 } });
    expect(parsed.background).toBeNull();
    expect(parsed.configurable).toBe(false);
    expect(parsed.configurationRequired).toBe(false);
  });

  test('idPrefixes dentro de cada recurso também conta (formato do addon de torrent)', () => {
    const parsed = parseManifest({
      ...baseManifest,
      idPrefixes: undefined,
      resources: [{ name: 'stream', types: ['movie'], idPrefixes: ['tt', 'kitsu'] }, { name: 'catalog', idPrefixes: ['tt'] }],
    });
    expect(parsed.idPrefixes).toEqual(['tt', 'kitsu']);
  });

  test('a API devolve os campos novos sem o caminho com token', async () => {
    await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url: MANIFEST_URL }), headers: { 'content-type': 'application/json' } });
    const text = await (await stremioRoutes.request('/addons')).text();
    expect(text).not.toContain('TOKEN');
    const dto = JSON.parse(text).addons[0];
    expect(dto).toMatchObject({ background: 'https://img.example.com/bg.jpg', idPrefixes: ['tt', 'kitsu:'], configurable: true, configurationRequired: false });
  });
});

describe('servesStreams com idPrefixes', () => {
  const parsed = (over: Record<string, unknown> = {}) => addonWith(parseManifest({ ...baseManifest, ...over }));

  test('manifest antigo (gravado antes destes campos) é normalizado na leitura', async () => {
    const { getDb } = await import('../../src/server/db/database.ts');
    const { listAddons, saveAddon } = await import('../../src/server/repo/stremio-addons.ts');
    const db = await getDb();
    const old = {
      id: 'old',
      name: 'Antigo',
      version: '1',
      description: '',
      logo: null,
      types: ['movie'],
      resources: ['catalog'],
      catalogs: [{ type: 'movie', id: 'top', name: 'Top' }],
    } as never;
    saveAddon(db, { manifestUrl: 'https://old.example.com/manifest.json', baseUrl: 'https://old.example.com', manifest: old });
    const [stored] = listAddons(db);
    expect(stored?.manifest).toMatchObject({ background: null, idPrefixes: [], configurable: false, configurationRequired: false });
    expect(stored?.manifest.catalogs[0]).toMatchObject({ genres: [], yearFilter: false, searchable: false, paged: false });
  });

  test('addon que só entende kitsu: não é chamado com IMDb', () => {
    const addon = parsed({ idPrefixes: ['kitsu:'] });
    expect(servesStreams(addon, 'movie', 'tt0111161')).toBe(false);
    expect(servesStreams(addon, 'movie', 'kitsu:1234')).toBe(true);
  });

  test('sem idPrefixes aceita qualquer esquema; com tt aceita IMDb', () => {
    expect(servesStreams(parsed({ idPrefixes: [] }), 'movie', 'kitsu:1')).toBe(true);
    expect(servesStreams(parsed(), 'series', 'tt0944947:1:1')).toBe(true);
  });

  test('tipo e recurso continuam valendo como barreira', () => {
    expect(servesStreams(parsed({ types: ['movie'] }), 'series', 'tt1')).toBe(false);
    expect(servesStreams(parsed({ resources: ['catalog'] }), 'movie', 'tt1')).toBe(false);
  });
});
