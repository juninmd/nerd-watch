import { buildMagnet, cleanName, parseInfoHash, safeTrackers } from './magnet.ts';

/**
 * Ponte entre o protocolo de addons e o engine: um stream que traz `infoHash` + `sources`
 * (o formato que os addons de torrent publicam) vira o mesmo magnet canônico que a fonte
 * "Torrent" já usa. Tudo aqui é função pura — sem rede, sem disco.
 *
 * Por que normalizar em vez de repassar o objeto do addon: o `infoHash` e os trackers vêm de
 * terceiros. Passar por `parseInfoHash` (40 hex) e `safeTrackers` (protocolo de tracker, nunca
 * host local) garante que o engine só recebe um magnet que ele já aceitaria de um link colado.
 */

export interface AddonTorrentRef {
  /** Infohash v1 normalizado em 40 hex minúsculos. */
  infoHash: string;
  /** Nome para exibir antes da metadata chegar. Vazio quando o addon não manda um. */
  name: string;
  /** Trackers já validados/filtrados (`dht:` e outros esquemas ficam de fora: o engine usa DHT sozinho). */
  trackers: string[];
}

/**
 * `sources` do addon embrulha o tracker em `tracker:` e o DHT em `dht:`. Só o tracker vira `tr=`;
 * o resto é descartado — um `dht:`/`ws:` não é tracker e não deve virar parâmetro do magnet.
 */
export const trackersFromSources = (sources: readonly string[]): string[] =>
  safeTrackers(
    sources
      .filter((source) => /^tracker:/i.test(source))
      .map((source) => source.slice('tracker:'.length).trim()),
  );

/** `null` quando o addon mandou um infohash inválido: quem chama lista o stream como não tocável. */
export const addonTorrentRef = (raw: { infoHash?: unknown; sources?: unknown; name?: unknown }): AddonTorrentRef | null => {
  const infoHash = typeof raw.infoHash === 'string' ? parseInfoHash(raw.infoHash.trim()) : null;
  if (!infoHash) return null;
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((source): source is string => typeof source === 'string') : [];
  return {
    infoHash,
    name: cleanName(typeof raw.name === 'string' ? raw.name : ''),
    trackers: trackersFromSources(sources),
  };
};

export const addonMagnet = (ref: AddonTorrentRef): string => buildMagnet(ref);
