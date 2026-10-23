/**
 * Só deixamos o servidor buscar legenda em `http(s)` público. A URL vem de addon ou do Internet Archive, ou
 * seja, de terceiro: sem esta barreira ela poderia apontar para `file:`, loopback, rede interna ou metadados
 * de nuvem (169.254.169.254).
 *
 * Duas camadas: o texto do host (IP literal e nomes reservados) aqui, e os endereços que o nome resolve,
 * checados em `load.ts` antes de cada conexão. Entre a checagem e a conexão ainda cabe DNS rebinding; o risco
 * residual está na PR.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const RESERVED_NAME = /(^localhost$|\.localhost$|\.local$|\.internal$|\.localdomain$)/;

/** Faixas IPv4 que não são internet pública: loopback, privadas, link-local, CGNAT, benchmark, multicast e reservadas. */
const privateIPv4 = (a: number, b: number): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && (b === 168 || b === 0)) ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 198 && (b === 18 || b === 19)) ||
  a >= 224;

/**
 * IPv6 só é público em 2000::/3 (primeiro hextet começa com 2 ou 3). Fica de fora o que embute IPv4 ou
 * aponta para rede local: 2002:: (6to4) e 2001:0000:: (Teredo) carregam um IPv4 que escapa da checagem acima.
 */
const publicIPv6 = (host: string): boolean => {
  const h = host.toLowerCase();
  if (!/^[23][0-9a-f]{0,3}:/.test(h)) return false;
  if (h.startsWith('2002:') || /^2001:0{0,4}:/.test(h)) return false;
  return true;
};

/** Endereço já resolvido (IPv4 ou IPv6 textual) é público? */
export const isPublicAddress = (addr: string): boolean => {
  if (addr.includes(':')) return publicIPv6(addr);
  const v4 = IPV4.exec(addr);
  if (!v4) return false;
  return !privateIPv4(Number(v4[1]), Number(v4[2]));
};

/** Literal IP (v4 ou v6) no host, sem nome DNS a resolver. */
export const isIpLiteral = (host: string): boolean => host.includes(':') || IPV4.test(host);

const hostAllowed = (host: string): boolean => {
  if (host.includes(':')) return publicIPv6(host);
  const v4 = IPV4.exec(host);
  if (v4) return !privateIPv4(Number(v4[1]), Number(v4[2]));
  // Nome sem ponto é rede interna (intranet, redis, db); nome reservado é localhost com outro rótulo.
  if (!host.includes('.')) return false;
  return !RESERVED_NAME.test(host);
};

export const isFetchableSubtitleUrl = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  // WHATWG normaliza IPv6 entre colchetes; tira os colchetes antes de checar.
  // Um ponto final ("localhost.") é o mesmo nome DNS e não pode escapar da checagem de nome reservado.
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === '') return false;
  return hostAllowed(host);
};
