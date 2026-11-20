import { networkInterfaces } from 'node:os';

export interface LanInterface {
  name: string;
  address: string;
  /** Pontuação interna para escolher a interface mais provável (Wi-Fi/Ethernet real antes de adaptadores virtuais). */
  score: number;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Nomes típicos de adaptadores virtuais (WSL, Docker, Hyper-V, VPN) que a TV da casa não alcança. */
const VIRTUAL_IFACE_RE = /(docker|vethernet|wsl|hyper-v|vbox|vmware|virbr|br-|tailscale|wg\d|utun|tun\d|tap\d|hamachi|zerotier|loopback)/i;
const PREFERRED_IFACE_RE = /(wi-?fi|wlan|en0|eth0|ethernet|wlp|enp)/i;

/**
 * Só endereços privados RFC1918 (10/8, 172.16/12, 192.168/16). Loopback (127/8), link-local/metadata
 * (169.254/16) e IPs públicos são recusados: a TV está na LAN e isso impede SSRF via SSDP malicioso.
 */
export const isPrivateLanIpv4 = (ip: string): boolean => {
  const match = IPV4_RE.exec(ip.trim());
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

/**
 * URLs vindas de anúncios SSDP ou XML de dispositivos UPnP só podem apontar para HTTP em IP privado da LAN.
 * Bloqueia `file:`, `https:` externo, loopback (`127.0.0.1`) e metadata de nuvem (`169.254.169.254`).
 */
export const isSafeLanUrl = (raw: string): boolean => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    return isPrivateLanIpv4(parsed.hostname);
  } catch {
    return false;
  }
};

export const rankInterface = (name: string, address: string): number => {
  let score = 0;
  if (address.startsWith('192.168.')) score += 30;
  else if (address.startsWith('10.')) score += 20;
  else score += 10;
  if (PREFERRED_IFACE_RE.test(name)) score += 25;
  if (VIRTUAL_IFACE_RE.test(name)) score -= 50;
  return score;
};

/** Lista IPs privados IPv4 da máquina ordenados do mais provável para o menos provável. */
export const listLanInterfaces = (preferredHost?: string): LanInterface[] => {
  const out: LanInterface[] = [];
  const seen = new Set<string>();

  if (preferredHost && isPrivateLanIpv4(preferredHost)) {
    seen.add(preferredHost);
    out.push({ name: 'CAST_HOST', address: preferredHost, score: 1000 });
  }

  const ifaces = networkInterfaces();
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      if (!isPrivateLanIpv4(entry.address) || seen.has(entry.address)) continue;
      seen.add(entry.address);
      out.push({ name, address: entry.address, score: rankInterface(name, entry.address) });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
};
