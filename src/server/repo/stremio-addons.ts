import type { Database } from 'bun:sqlite';
import { ValidationError } from '../lib/validation-error.ts';
import type { AddonCatalog, AddonManifest } from '../providers/stremio/protocol.ts';

/** Teto de addons: cada um vira requisições externas; sem teto a tela e as buscas de legenda crescem sem limite. */
export const STREMIO_ADDONS_MAX = 20;

interface AddonRow {
  id: string;
  manifest_url: string;
  base_url: string;
  manifest: string;
  added_at: string;
  /** `0` = instalado, mas fora das consultas automáticas. */
  enabled: number;
}

export interface InstalledAddon {
  id: string;
  manifestUrl: string;
  baseUrl: string;
  manifest: AddonManifest;
  addedAt: string;
  /** Desligado continua instalado (dá para reativar), mas não entra em título, busca, quadros nem legenda. */
  enabled: boolean;
}

/**
 * Manifest guardado antes de o app conhecer estes campos (`background`, `idPrefixes`, filtros do
 * catálogo) não tem as chaves no JSON: normalizar na leitura evita que a interface quebre depois de
 * atualizar o app. Campos obrigatórios do manifest são preenchidos um a um; catálogo sem tipo ou id
 * é descartado (não dá para navegar nele).
 */
const normalizeManifest = (stored: Partial<AddonManifest> & { catalogs?: Array<Partial<AddonCatalog>> }): AddonManifest => ({
  id: stored.id ?? '',
  name: stored.name ?? '',
  version: stored.version ?? '',
  description: stored.description ?? '',
  logo: stored.logo ?? null,
  background: stored.background ?? null,
  types: stored.types ?? [],
  resources: stored.resources ?? [],
  idPrefixes: stored.idPrefixes ?? [],
  configurable: stored.configurable ?? false,
  configurationRequired: stored.configurationRequired ?? false,
  catalogs: (stored.catalogs ?? [])
    .map((catalog): AddonCatalog => ({
      type: catalog.type ?? '',
      id: catalog.id ?? '',
      name: catalog.name ?? catalog.id ?? '',
      searchable: catalog.searchable ?? false,
      paged: catalog.paged ?? false,
      genres: catalog.genres ?? [],
      yearFilter: catalog.yearFilter ?? false,
    }))
    .filter((catalog) => catalog.type !== '' && catalog.id !== ''),
});

const toAddon = (row: AddonRow): InstalledAddon => {
  const stored = JSON.parse(row.manifest) as Partial<AddonManifest> & { catalogs?: Array<Partial<AddonCatalog>> };
  return {
    id: row.id,
    manifestUrl: row.manifest_url,
    baseUrl: row.base_url,
    manifest: normalizeManifest(stored),
    addedAt: row.added_at,
    // Banco antigo pode vir sem a coluna (`undefined`): nesse caso o addon estava ligado.
    enabled: row.enabled !== 0,
  };
};

export const listAddons = (db: Database): InstalledAddon[] =>
  (db.query('SELECT * FROM stremio_addons ORDER BY added_at, id').all() as AddonRow[]).map(toAddon);

/** Só os ligados: é esta lista que alimenta título, busca, quadros e legendas. */
export const listEnabledAddons = (db: Database): InstalledAddon[] => listAddons(db).filter((addon) => addon.enabled);

/** Liga/desliga sem remover. `false` quando o id não existe. */
export const setAddonEnabled = (db: Database, id: string, enabled: boolean): boolean =>
  db.query('UPDATE stremio_addons SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0;

export const getAddon = (db: Database, id: string): InstalledAddon | null => {
  const row = db.query('SELECT * FROM stremio_addons WHERE id = ?').get(id) as AddonRow | null;
  return row ? toAddon(row) : null;
};

/** Reinstalar o mesmo link só atualiza o manifest guardado (idempotente, preservando ligado/desligado). */
export const saveAddon = (db: Database, input: { manifestUrl: string; baseUrl: string; manifest: AddonManifest }): InstalledAddon =>
  db.transaction((): InstalledAddon => {
    const encoded = JSON.stringify(input.manifest);
    const existing = db.query('SELECT * FROM stremio_addons WHERE manifest_url = ?').get(input.manifestUrl) as AddonRow | null;
    if (existing) {
      db.query('UPDATE stremio_addons SET manifest = ?, base_url = ? WHERE id = ?').run(encoded, input.baseUrl, existing.id);
      return toAddon({ ...existing, base_url: input.baseUrl, manifest: encoded });
    }
    const count = (db.query('SELECT COUNT(*) AS n FROM stremio_addons').get() as { n: number }).n;
    if (count >= STREMIO_ADDONS_MAX) throw new ValidationError(`limite de ${STREMIO_ADDONS_MAX} addons; remova algum antes`);
    const row: AddonRow = {
      id: crypto.randomUUID(),
      manifest_url: input.manifestUrl,
      base_url: input.baseUrl,
      manifest: encoded,
      added_at: new Date().toISOString(),
      enabled: 1,
    };
    db.query('INSERT INTO stremio_addons (id, manifest_url, base_url, manifest, added_at, enabled) VALUES (?, ?, ?, ?, ?, ?)').run(
      row.id,
      row.manifest_url,
      row.base_url,
      row.manifest,
      row.added_at,
      row.enabled,
    );
    return toAddon(row);
  })();

export const deleteAddon = (db: Database, id: string): boolean => db.query('DELETE FROM stremio_addons WHERE id = ?').run(id).changes > 0;
