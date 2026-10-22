export interface ChannelRef {
  name: string;
  host: string;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;
const CHANNEL_NAME = /^[a-z0-9_.-]{1,64}$/;
/** Sufixos que nunca são instância pública: rede local, nomes de teste e reservados. */
const PRIVATE_SUFFIX = /\.(localhost|local|localdomain|internal|lan|home|intranet|corp|test|invalid|example|onion)$/;

/**
 * Host de uma instância pública: só nome DNS com TLD de letras. Porta, IPv6, IP literal (último rótulo numérico)
 * e nomes locais ficam de fora. O servidor é quem faz a requisição, então isto é a barreira contra SSRF.
 */
export const parseInstanceHost = (raw: string): string | null => {
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 253 || host.includes(':')) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1] ?? '')) return null;
  if (host === 'localhost' || PRIVATE_SUFFIX.test(host)) return null;
  return host;
};

/** `canal@instancia.tld` (também é o corpo do handle, sem o prefixo `peertube:`). */
const parseCanalAt = (text: string): ChannelRef | null => {
  const at = text.lastIndexOf('@');
  if (at <= 0) return null;
  const name = text.slice(0, at).toLowerCase();
  const host = parseInstanceHost(text.slice(at + 1));
  return CHANNEL_NAME.test(name) && host ? { name, host } : null;
};

/** Aceita `canal@instancia.tld` ou `https://instancia.tld/c/canal` (também `/video-channels/canal`). */
export const parseChannelInput = (raw: string): ChannelRef | null => {
  const text = raw.trim();
  if (!text.includes('/') && !text.includes(':')) return parseCanalAt(text);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = parseInstanceHost(url.hostname);
  const name = /^\/(?:c|video-channels)\/([^/]+)\/?$/.exec(url.pathname)?.[1]?.toLowerCase();
  if (!host || !name || !CHANNEL_NAME.test(name)) return null;
  return { name, host };
};

/** Handle guardado no banco: `peertube:<canal>@<host>`. Revalidado a cada uso (um backup importado pode trazer lixo). */
export const parseHandle = (handle: string): ChannelRef | null => (handle.startsWith('peertube:') ? parseCanalAt(handle.slice('peertube:'.length)) : null);

export const handleOf = (ref: ChannelRef): string => `peertube:${ref.name}@${ref.host}`;
