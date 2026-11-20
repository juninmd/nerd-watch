import dgram from 'node:dgram';
import { type CastDevice, parseDeviceDescription, parseSsdpResponse } from './dlna-xml.ts';
import { isSafeLanUrl, listLanInterfaces } from './network.ts';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:service:AVTransport:1',
];
const MAX_DESC_BYTES = 256 * 1024;
const DESC_TIMEOUT_MS = 2500;
const DEFAULT_DISCOVER_MS = 2200;

const buildMSearch = (st: string): Buffer =>
  Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      `ST: ${st}`,
      '',
      '',
    ].join('\r\n'),
  );

const fetchDescriptionXml = async (location: string, fetcher: typeof fetch): Promise<string | null> => {
  if (!isSafeLanUrl(location)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DESC_TIMEOUT_MS);
  try {
    const res = await fetcher(location, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_DESC_BYTES) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_DESC_BYTES) return null;
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export interface DiscoverOptions {
  timeoutMs?: number;
  fetcher?: typeof fetch;
  /** Endereços IPv4 locais usados para enviar o multicast; padrão: todas as interfaces LAN privadas. */
  bindAddresses?: string[];
}

/**
 * Descobre TVs DLNA/UPnP (`MediaRenderer` / `AVTransport`) na rede local via multicast UDP SSDP.
 * Faz bind por interface LAN com `setMulticastInterface`: no Windows (ou máquinas com Docker/WSL), um
 * único socket em `0.0.0.0` costuma enviar o multicast pela interface errada e não achar a TV.
 */
export const discoverDlnaDevices = async (opts: DiscoverOptions = {}): Promise<CastDevice[]> => {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DISCOVER_MS;
  const fetcher = opts.fetcher ?? fetch;
  const locations = new Set<string>();
  const addrs = opts.bindAddresses ?? listLanInterfaces().map((i) => i.address);
  const targets = addrs.length > 0 ? addrs : [undefined];

  await new Promise<void>((resolve) => {
    let settled = false;
    const sockets: dgram.Socket[] = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const sock of sockets) {
        try {
          sock.close();
        } catch {
          // Socket já fechado.
        }
      }
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);

    for (const addr of targets) {
      try {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sockets.push(socket);
        socket.on('error', () => {
          try {
            socket.close();
          } catch {
            // Ignora falha individual de interface.
          }
        });
        socket.on('message', (msg) => {
          const hit = parseSsdpResponse(msg.toString('utf8'));
          if (hit) locations.add(hit.location);
        });
        const sendQueries = () => {
          if (addr) {
            try {
              socket.setMulticastInterface(addr);
            } catch {
              // Segue com a interface padrão se o SO recusar.
            }
          }
          for (const st of SEARCH_TARGETS) {
            const payload = buildMSearch(st);
            socket.send(payload, 0, payload.length, SSDP_PORT, SSDP_ADDR, () => {});
          }
        };
        if (addr) socket.bind(0, addr, sendQueries);
        else socket.bind(0, sendQueries);
      } catch {
        // Segue para a próxima interface.
      }
    }
    if (sockets.length === 0) finish();
  });

  if (locations.size === 0) return [];

  const fetched = await Promise.all(
    [...locations].slice(0, 20).map(async (location) => {
      const xml = await fetchDescriptionXml(location, fetcher);
      return xml ? parseDeviceDescription(xml, location) : null;
    }),
  );

  // Deduplica por UDN (a mesma TV costuma responder aos dois STs).
  const byId = new Map<string, CastDevice>();
  for (const dev of fetched) {
    if (dev && !byId.has(dev.id)) byId.set(dev.id, dev);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
};
