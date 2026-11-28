import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { subtitleAddonBases } from '../../src/server/providers/subtitles/addon-list.ts';
import { listAddons, listEnabledAddons, saveAddon } from '../../src/server/repo/stremio-addons.ts';
import { searchRoutes } from '../../src/server/routes/search.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

/**
 * Ligar/desligar addon sem remover. Desligado continua instalado (dá para reativar), mas sai de toda
 * consulta automática: título, busca, quadros e legenda. A tela do próprio addon continua acessível.
 */

const A_URL = 'https://a.example.com/manifest.json';
const B_URL = 'https://b.example.com/manifest.json';
const S_URL = 'https://subs.example.com/manifest.json';
const A_BASE = 'https://a.example.com';
const B_BASE = 'https://b.example.com';
const S_BASE = 'https://subs.example.com';

const manifest = (name: string, resources: unknown[] = [{ name: 'stream', types: ['movie'], idPrefixes: ['tt'] }], catalogs: unknown[] = []) => ({
  id: `org.${name}`,
  name,
  version: '1.0.0',
  types: ['movie'],
  resources,
  catalogs,
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const install = async (url: string): Promise<{ id: string; enabled: boolean }> => {
  const res = await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url }), headers: { 'content-type': 'application/json' } });
  return res.json() as Promise<{ id: string; enabled: boolean }>;
};

const patch = (id: string, body: unknown) =>
  stremioRoutes.request(`/addons/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const streamAndCatalog = [
  { name: 'stream', types: ['movie'], idPrefixes: ['tt'] },
  { name: 'catalog', types: ['movie'], idPrefixes: ['tt'] },
];

const searchable = [{ type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'search' }] }];

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  setAddonFetch(async (url) => {
    if (url === A_URL) return json(manifest('Addon A', streamAndCatalog, searchable));
    if (url === B_URL) return json(manifest('Addon B', streamAndCatalog, searchable));
    if (url === S_URL) return json(manifest('Legendas', ['subtitles']));
    if (url.startsWith(`${A_BASE}/stream/`)) return json({ streams: [{ title: 'A 1080p', url: 'https://cdn.example.com/a.mp4' }] });
    if (url.startsWith(`${B_BASE}/stream/`)) return json({ streams: [{ title: 'B 720p', url: 'https://cdn.example.com/b.mp4' }] });
    if (url.startsWith(`${A_BASE}/catalog/`)) return json({ metas: [{ id: 'tt1', type: 'movie', name: 'Item do A' }] });
    if (url.startsWith(`${B_BASE}/catalog/`)) return json({ metas: [{ id: 'tt2', type: 'movie', name: 'Item do B' }] });
    return json({}, 404);
  });
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
});

describe('PATCH /addons/:id', () => {
  test('desliga e religa, devolvendo o estado novo', async () => {
    const a = await install(A_URL);
    expect(a.enabled).toBe(true);

    const off = await patch(a.id, { enabled: false });
    expect(off.status).toBe(200);
    expect((await off.json()).enabled).toBe(false);

    const on = await patch(a.id, { enabled: true });
    expect((await on.json()).enabled).toBe(true);
  });

  test('corpo inválido é 400 e id inexistente é 404', async () => {
    const a = await install(A_URL);
    expect((await patch(a.id, {})).status).toBe(400);
    expect((await patch(a.id, { enabled: 'sim' })).status).toBe(400);
    expect((await patch('nao-existe', { enabled: false })).status).toBe(404);
  });

  test('reinstalar o mesmo link não religa nem duplica', async () => {
    const a = await install(A_URL);
    await patch(a.id, { enabled: false });
    await install(A_URL);
    const addons = await (await stremioRoutes.request('/addons')).json();
    expect(addons.addons).toHaveLength(1);
    expect(addons.addons[0].enabled).toBe(false);
  });
});

describe('addon desligado sai das consultas automáticas', () => {
  const setup = async () => {
    const a = await install(A_URL);
    const b = await install(B_URL);
    await patch(a.id, { enabled: false });
    return { a, b };
  };

  test('streams do título não consultam o addon desligado', async () => {
    await setup();
    const dto = await (await stremioRoutes.request('/streams?mediaType=movie&imdbId=tt1234567')).json();
    expect(dto.addons.map((g: { name: string }) => g.name)).toEqual(['Addon B']);
  });

  test('`only` consulta um addon só (tela de carregamento) e nunca religa o desligado', async () => {
    const { a, b } = await setup();
    const one = await (await stremioRoutes.request(`/streams?mediaType=movie&imdbId=tt1234567&only=${b.id}`)).json();
    expect(one.addons.map((g: { name: string }) => g.name)).toEqual(['Addon B']);
    const off = await (await stremioRoutes.request(`/streams?mediaType=movie&imdbId=tt1234567&only=${a.id}`)).json();
    expect(off.addons).toEqual([]);
    expect((await stremioRoutes.request('/streams?mediaType=movie&imdbId=tt1234567&only=../x')).status).toBe(400);
  });

  test('quadros (Descobrir) só trazem catálogo de addon ligado', async () => {
    await setup();
    const { boards } = await (await stremioRoutes.request('/boards')).json();
    expect(boards).toHaveLength(1);
    expect(boards[0].addonName).toBe('Addon B');
  });

  test('busca não traz item do addon desligado', async () => {
    await setup();
    const res = await searchRoutes.request('/?q=item');
    const dto = await res.json();
    expect(dto.addonResults.map((r: { addonName: string }) => r.addonName)).toEqual(['Addon B']);
  });

  test('addon de legenda desligado não entra na busca de legendas', async () => {
    const subs = await install(S_URL);
    expect(await subtitleAddonBases()).toContain(S_BASE);
    await patch(subs.id, { enabled: false });
    expect(await subtitleAddonBases()).not.toContain(S_BASE);
  });

  test('a tela do próprio addon continua funcionando (acesso explícito)', async () => {
    const { a } = await setup();
    const res = await stremioRoutes.request(`/addons/${a.id}/streams/movie/tt1234567`);
    expect(res.status).toBe(200);
    expect((await res.json()).streams).toHaveLength(1);
  });

  test('repo separa instalados de ligados', async () => {
    const db = await getDb();
    const a = await install(A_URL);
    await patch(a.id, { enabled: false });
    expect(listAddons(db)).toHaveLength(1);
    expect(listEnabledAddons(db)).toHaveLength(0);
  });
});

describe('migração da coluna enabled', () => {
  test('banco com a tabela antiga ganha a coluna (default ligado) e reabrir não quebra', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nerd-watch-addons-mig-'));
    const path = join(dir, 'app.db');
    try {
      const old = new Database(path, { create: true });
      old.exec(`
        CREATE TABLE stremio_addons (
          id TEXT PRIMARY KEY,
          manifest_url TEXT NOT NULL UNIQUE,
          base_url TEXT NOT NULL,
          manifest TEXT NOT NULL,
          added_at TEXT NOT NULL
        );
      `);
      old.query('INSERT INTO stremio_addons (id, manifest_url, base_url, manifest, added_at) VALUES (?, ?, ?, ?, ?)').run('1', A_URL, A_BASE, JSON.stringify(manifest('Antigo')), '2026-01-01');
      old.close();

      const upgraded = openDb(path);
      const columns = upgraded.query<{ name: string }, []>('PRAGMA table_info(stremio_addons)').all();
      expect(columns.some((c) => c.name === 'enabled')).toBe(true);
      const rows = upgraded.query<{ enabled: number }, []>('SELECT enabled FROM stremio_addons').all();
      expect(rows).toEqual([{ enabled: 1 }]);
      upgraded.close();

      // Reabrir roda a migração de novo: idempotente, não duplica coluna nem reseta o estado.
      const again = openDb(path);
      again.query('UPDATE stremio_addons SET enabled = 0').run();
      again.close();
      const third = openDb(path);
      expect(third.query<{ enabled: number }, []>('SELECT enabled FROM stremio_addons').all()).toEqual([{ enabled: 0 }]);
      third.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('saveAddon grava ligado por padrão', async () => {
    const db = await getDb();
    const saved = saveAddon(db, { manifestUrl: A_URL, baseUrl: A_BASE, manifest: manifest('Novo') as never });
    expect(saved.enabled).toBe(true);
  });
});
