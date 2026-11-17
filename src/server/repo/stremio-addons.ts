import type { Database } from 'bun:sqlite';
import { ValidationError } from '../lib/validation-error.ts';
import type { AddonManifest } from '../providers/stremio/protocol.ts';

/** Teto de addons: cada um vira requisições externas; sem teto a tela e as buscas de legenda crescem sem limite. */
export const STREMIO_ADDONS_MAX = 20;

interface AddonRow {
  id: string;
  manifest_url: string;
  base_url: string;
  manifest: string;
  added_at: string;
}

export interface InstalledAddon {
  id: string;
  manifestUrl: string;
  baseUrl: string;
  manifest: AddonManifest;
  addedAt: string;
}

const toAddon = (row: AddonRow): InstalledAddon => ({
  id: row.id,
  manifestUrl: row.manifest_url,
  baseUrl: row.base_url,
  manifest: JSON.parse(row.manifest) as AddonManifest,
  addedAt: row.added_at,
});

export const listAddons = (db: Database): InstalledAddon[] =>
  (db.query('SELECT * FROM stremio_addons ORDER BY added_at, id').all() as AddonRow[]).map(toAddon);

export const getAddon = (db: Database, id: string): InstalledAddon | null => {
  const row = db.query('SELECT * FROM stremio_addons WHERE id = ?').get(id) as AddonRow | null;
  return row ? toAddon(row) : null;
};

/** Reinstalar o mesmo link só atualiza o manifest guardado (idempotente). */
export const saveAddon = (db: Database, input: { manifestUrl: string; baseUrl: string; manifest: AddonManifest }): InstalledAddon => {
  const existing = db.query('SELECT * FROM stremio_addons WHERE manifest_url = ?').get(input.manifestUrl) as AddonRow | null;
  if (existing) {
    db.query('UPDATE stremio_addons SET manifest = ?, base_url = ? WHERE id = ?').run(JSON.stringify(input.manifest), input.baseUrl, existing.id);
    return toAddon({ ...existing, base_url: input.baseUrl, manifest: JSON.stringify(input.manifest) });
  }
  const count = (db.query('SELECT COUNT(*) AS n FROM stremio_addons').get() as { n: number }).n;
  if (count >= STREMIO_ADDONS_MAX) throw new ValidationError(`limite de ${STREMIO_ADDONS_MAX} addons; remova algum antes`);
  const row: AddonRow = {
    id: crypto.randomUUID(),
    manifest_url: input.manifestUrl,
    base_url: input.baseUrl,
    manifest: JSON.stringify(input.manifest),
    added_at: new Date().toISOString(),
  };
  db.query('INSERT INTO stremio_addons (id, manifest_url, base_url, manifest, added_at) VALUES (?, ?, ?, ?, ?)').run(row.id, row.manifest_url, row.base_url, row.manifest, row.added_at);
  return toAddon(row);
};

export const deleteAddon = (db: Database, id: string): boolean => db.query('DELETE FROM stremio_addons WHERE id = ?').run(id).changes > 0;
