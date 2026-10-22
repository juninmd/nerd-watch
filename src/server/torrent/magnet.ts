/**
 * Fronteira de entrada do provider de torrent genérico: o que o usuário cola vira um `TorrentRef`
 * normalizado, e só esse formato (magnet reconstruído) chega ao engine. Tudo aqui é função pura,
 * sem rede e sem disco.
 *
 * Por que reconstruir em vez de repassar a string: `xt`, `dn` e `tr` são revalidados e o resto
 * (`x.pe`, `ws`, `so`, parâmetros desconhecidos) é descartado. Trackers apontando para loopback ou
 * rede privada também saem: um magnet ou um `.torrent` de terceiro não pode fazer o servidor local
 * conversar com serviços da máquina ou da LAN do usuário.
 */

export const MAGNET_MAX_LENGTH = 4096;
const MAX_TRACKERS = 20;
const MAX_NAME_CHARS = 200;
/** Limite de nome de arquivo em quase todo sistema de arquivos (bytes UTF-8). */
const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_CHARS = 1024;
const TRACKER_PROTOCOLS = new Set(['udp:', 'http:', 'https:', 'ws:', 'wss:']);
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class MagnetError extends Error {}

export interface TorrentRef {
  /** Infohash v1 em minúsculas, 40 hex. */
  infoHash: string;
  /** Nome para exibir antes da metadata chegar. Vazio quando o link não traz `dn`. */
  name: string;
  /** Trackers já filtrados (ver `isPrivateHost`). */
  trackers: string[];
}

/** 40 hex ou 32 base32 (formato antigo dos magnets). Devolve o hex minúsculo, ou null se inválido. */
export const parseInfoHash = (raw: string): string | null => {
  if (/^[0-9a-fA-F]{40}$/.test(raw)) return raw.toLowerCase();
  if (!/^[A-Za-z2-7]{32}$/.test(raw)) return null;
  let bits = 0;
  let value = 0;
  let hex = '';
  for (const ch of raw.toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      hex += ((value >>> (bits - 8)) & 0xff).toString(16).padStart(2, '0');
      bits -= 8;
    }
  }
  return hex.length === 40 ? hex : null;
};

/** Hosts que só alcançam a própria máquina ou a LAN. Não cobre nome DNS que resolva para IP privado. */
export const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.startsWith('[')) {
    return host === '[::1]' || host === '[::]' || /^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host);
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** Filtra trackers: só protocolos de tracker e nunca host local/privado. Deduplica e limita. */
export const safeTrackers = (candidates: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const candidate of candidates) {
    if (out.size >= MAX_TRACKERS) break;
    let url: URL;
    try {
      url = new URL(candidate.trim());
    } catch {
      continue;
    }
    if (!TRACKER_PROTOCOLS.has(url.protocol) || isPrivateHost(url.hostname)) continue;
    out.add(url.href);
  }
  return [...out];
};

/** Remove caracteres de controle e limita o tamanho: `dn` vem de terceiros e vai parar na interface. */
export const cleanName = (raw: string | null | undefined): string =>
  Array.from(raw ?? '')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, MAX_NAME_CHARS);

/** Nomes de parâmetro sem distinção de caixa: clientes escrevem `XT=` e `Dn=` e o valor continua validado. */
const paramValues = (url: URL, name: string): string[] => {
  const out: string[] = [];
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name) out.push(value);
  return out;
};

export const parseMagnet = (input: string): TorrentRef => {
  if (input.length > MAGNET_MAX_LENGTH) throw new MagnetError('magnet grande demais');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new MagnetError('magnet inválido');
  }
  if (url.protocol !== 'magnet:') throw new MagnetError('o link precisa começar com magnet:');

  const hashes = new Set<string>();
  for (const xt of paramValues(url, 'xt')) {
    const match = /^urn:btih:(.*)$/i.exec(xt);
    if (!match) continue;
    const hash = parseInfoHash(match[1] ?? '');
    if (!hash) throw new MagnetError('infohash inválido (40 caracteres hexadecimais ou 32 base32)');
    hashes.add(hash);
  }
  if (hashes.size === 0) throw new MagnetError('magnet sem infohash BitTorrent (xt=urn:btih:…)');
  // Dois infohashes no mesmo link é ambíguo: recusar é mais seguro que escolher um.
  if (hashes.size > 1) throw new MagnetError('magnet com mais de um infohash');

  return {
    infoHash: [...hashes][0] as string,
    name: cleanName(paramValues(url, 'dn')[0]),
    trackers: safeTrackers(paramValues(url, 'tr')),
  };
};

/** Magnet canônico: é ele que vai para o engine e para `torrent_sources`. */
export const buildMagnet = (ref: TorrentRef): string => {
  const parts = [`xt=urn:btih:${ref.infoHash}`];
  if (ref.name) parts.push(`dn=${encodeURIComponent(ref.name)}`);
  for (const tracker of ref.trackers) parts.push(`tr=${encodeURIComponent(tracker)}`);
  return `magnet:?${parts.join('&')}`;
};

/**
 * Caminho de arquivo declarado pelo torrent é seguro para o disco? Recusa segmento `..`/`.`, vazio,
 * caminho absoluto, unidade do Windows (`C:`) e nomes que o sistema de arquivos não aceita.
 * O webtorrent grava em `path.join(pasta, file.path)`: sem esta checagem um torrent hostil escreve
 * fora da pasta de download.
 */
export const isSafeTorrentPath = (path: string): boolean => {
  if (!path || path.length > MAX_PATH_CHARS || path.includes('\0')) return false;
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
  return path.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..' && Buffer.byteLength(segment) <= MAX_SEGMENT_BYTES);
};
