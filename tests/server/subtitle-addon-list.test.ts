import { beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { subtitleAddonBases } from '../../src/server/providers/subtitles/addon-list.ts';
import { config } from '../../src/server/config/config.ts';
import { saveAddon } from '../../src/server/repo/stremio-addons.ts';

const manifest = (resources: string[]) => ({ id: 'x', name: 'X', version: '', description: '', logo: null, types: [], resources, catalogs: [] });

describe('subtitleAddonBases', () => {
  beforeEach(() => resetDbForTests(openDb(':memory:')));

  test('junta os do ambiente com os instalados que declaram subtitles, sem repetir', async () => {
    const { getDb } = await import('../../src/server/db/database.ts');
    const db = await getDb();
    saveAddon(db, { manifestUrl: 'https://a.example.com/manifest.json', baseUrl: 'https://a.example.com', manifest: manifest(['subtitles']) });
    saveAddon(db, { manifestUrl: 'https://b.example.com/manifest.json', baseUrl: 'https://b.example.com', manifest: manifest(['catalog']) });
    saveAddon(db, { manifestUrl: `${config.subtitles.addons[0]}/manifest.json`, baseUrl: config.subtitles.addons[0] as string, manifest: manifest(['subtitles']) });
    const bases = await subtitleAddonBases();
    expect(bases).toContain('https://a.example.com');
    expect(bases).not.toContain('https://b.example.com');
    expect(bases.filter((b) => b === config.subtitles.addons[0])).toHaveLength(1);
  });
});
