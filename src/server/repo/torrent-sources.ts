import type { Database } from 'bun:sqlite';

export interface TorrentSource {
  infoHash: string;
  /** Magnet canônico (ver `buildMagnet`); nunca a URL crua do usuário. */
  magnet: string;
  /** Momento da importação. Vira `postedAt` dos itens e fica estável entre sincronizações. */
  addedAt: string;
}

/** Primeira importação vence: regravar não move `added_at`, que segura a ordem e o `postedAt`. */
export const saveTorrentSource = (db: Database, infoHash: string, magnet: string, addedAt: string = new Date().toISOString()): void => {
  db.query('INSERT INTO torrent_sources (infohash, magnet, added_at) VALUES (?, ?, ?) ON CONFLICT (infohash) DO NOTHING').run(infoHash, magnet, addedAt);
};

export const getTorrentSource = (db: Database, infoHash: string): TorrentSource | null => {
  const row = db
    .query<{ infohash: string; magnet: string; added_at: string }, [string]>('SELECT infohash, magnet, added_at FROM torrent_sources WHERE infohash = ?')
    .get(infoHash);
  return row ? { infoHash: row.infohash, magnet: row.magnet, addedAt: row.added_at } : null;
};
