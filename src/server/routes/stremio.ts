import { Hono } from 'hono';
import { getDb } from '../db/database.ts';
import { assertKnownKeys, guardInput, readJsonObject } from '../http/json-body.ts';
import { ValidationError } from '../lib/validation-error.ts';
import { AddonError } from '../providers/stremio/client.ts';
import { fetchCatalog, fetchManifestFrom, fetchMeta, fetchStreams } from '../providers/stremio/protocol.ts';
import { parseAddonUrl } from '../providers/stremio/url.ts';
import { deleteAddon, getAddon, type InstalledAddon, listAddons, saveAddon } from '../repo/stremio-addons.ts';

export const stremioRoutes = new Hono();

/** O manifest URL pode ter token no caminho: o cliente só recebe o domínio. */
const toDto = (a: InstalledAddon) => ({
  id: a.id,
  host: new URL(a.baseUrl).host,
  name: a.manifest.name,
  version: a.manifest.version,
  description: a.manifest.description,
  logo: a.manifest.logo,
  types: a.manifest.types,
  resources: a.manifest.resources,
  catalogs: a.manifest.catalogs,
  addedAt: a.addedAt,
});

/** Falha do addon vira 502/504 com mensagem fixa; qualquer outro erro segue para o handler padrão. */
const guardAddon = (c: Parameters<typeof guardInput>[0], run: () => Response | Promise<Response>): Promise<Response> =>
  guardInput(c, async () => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof AddonError) {
        const status = err.failure === 'timeout' ? 504 : err.failure === 'untrusted_url' ? 400 : 502;
        return c.json({ error: err.message }, status);
      }
      throw err;
    }
  });

stremioRoutes.get('/addons', async (c) => c.json({ addons: listAddons(await getDb()).map(toDto) }));

stremioRoutes.post('/addons', (c) =>
  guardAddon(c, async () => {
    const body = await readJsonObject(c);
    assertKnownKeys(body, ['url']);
    const parsed = parseAddonUrl(body.url);
    const manifest = await fetchManifestFrom(parsed.manifestUrl);
    const addon = saveAddon(await getDb(), { manifestUrl: parsed.manifestUrl, baseUrl: parsed.baseUrl, manifest });
    return c.json(toDto(addon), 201);
  }),
);

stremioRoutes.delete('/addons/:id', async (c) => {
  const removed = deleteAddon(await getDb(), c.req.param('id'));
  return removed ? c.json({ ok: true }) : c.json({ error: 'addon não encontrado' }, 404);
});

const withAddon = (c: Parameters<typeof guardInput>[0], run: (a: InstalledAddon) => Promise<Response>): Promise<Response> =>
  guardAddon(c, async () => {
    const addon = getAddon(await getDb(), c.req.param('id') ?? '');
    if (!addon) return c.json({ error: 'addon não encontrado' }, 404);
    return run(addon);
  });

stremioRoutes.get('/addons/:id/catalog/:type/:catalogId', (c) =>
  withAddon(c, async (addon) => {
    const search = c.req.query('search')?.trim().slice(0, 100) || undefined;
    const skipRaw = c.req.query('skip');
    const skip = skipRaw === undefined ? 0 : /^\d{1,6}$/.test(skipRaw) ? Number(skipRaw) : Number.NaN;
    if (!Number.isFinite(skip)) throw new ValidationError('skip inválido');
    const known = addon.manifest.catalogs.some((k) => k.type === c.req.param('type') && k.id === c.req.param('catalogId'));
    if (!known) throw new ValidationError('catálogo não declarado pelo addon');
    return c.json({ items: await fetchCatalog(addon.baseUrl, c.req.param('type'), c.req.param('catalogId'), { search, skip }) });
  }),
);

stremioRoutes.get('/addons/:id/meta/:type/:itemId', (c) =>
  withAddon(c, async (addon) => {
    const meta = await fetchMeta(addon.baseUrl, c.req.param('type'), c.req.param('itemId'));
    return meta ? c.json(meta) : c.json({ error: 'item não encontrado no addon' }, 404);
  }),
);

stremioRoutes.get('/addons/:id/streams/:type/:itemId', (c) =>
  withAddon(c, async (addon) => c.json({ streams: await fetchStreams(addon.baseUrl, c.req.param('type'), c.req.param('itemId')) })),
);
