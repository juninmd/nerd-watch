import { SourceError } from './types.ts';

/** Servidor de mídia da casa (Jellyfin, Plex): quem responde e como chamamos o segredo nas mensagens. */
export interface Service {
  name: string;
  /** Nome do segredo para o usuário ("chave de API", "token"). */
  secretLabel: string;
}

export type MediaFetch = (url: URL, init: RequestInit) => Promise<Response>;

const realFetch: MediaFetch = (url, init) => fetch(url, init);
let fetchImpl: MediaFetch = realFetch;

/** Só testes: troca a rede por um fake. Sem argumento volta ao fetch real. */
export const setMediaFetchForTests = (fn?: MediaFetch): void => {
  fetchImpl = fn ?? realFetch;
};

/** Até o servidor responder: um vídeo longo não é cortado no meio pelo timeout depois disso. */
export const HEAD_TIMEOUT_MS = 20_000;
/** Miniatura acima disso não é capa razoável e nunca entra inteira em memória. */
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ITEMS = 500;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const RANGE_RE = /^bytes=\d*-\d*$/;

/** null quando o endereço vale; senão a mensagem para o usuário. LAN (IP privado) é o uso normal, então é aceita. */
export const serverUrlProblem = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'informe o endereço completo, começando com http:// ou https://';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'o endereço precisa começar com http:// ou https://';
  if (url.username || url.password) return 'não coloque usuário e senha no endereço';
  if (url.search || url.hash) return 'o endereço não pode ter ? nem #';
  return null;
};

/** Base da API: origem mais caminho opcional (servidor atrás de proxy em /jellyfin), sempre com barra final. */
export const serverBase = (value: string, service: Service): URL => {
  if (serverUrlProblem(value)) throw new SourceError(`endereço do ${service.name} inválido — corrija em Conexões`, 501);
  const url = new URL(value);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
};

/** Caminho da API resolvido contra a base. O caminho é sempre escrito pelo nosso código, nunca vem do usuário cru. */
export const apiUrl = (base: URL, path: string, query: Record<string, string> = {}): URL => {
  const url = new URL(path.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
};

/** Resposta que deveria ser lista; qualquer outra forma vira lista vazia em vez de quebrar a rota. */
export const arrayOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Quebra de linha ou caractere de controle no caminho: nunca chega a um cabeçalho ou URL. */
const hasControlChar = (text: string): boolean => [...text].some((ch) => ch.charCodeAt(0) < 0x20);

/** Caminho que o próprio servidor devolveu (parte de arquivo, miniatura): só passa se casar o padrão e não tiver escape. */
export const serverPath = (raw: unknown, pattern: RegExp): string | null => {
  // Dot-segment codificado (%2e) é normalizado pelo parser de URL: bloqueado junto com barra e contrabarra codificadas.
  if (typeof raw !== 'string' || !pattern.test(raw) || raw.includes('//') || hasControlChar(raw) || /%(2e|2f|5c)/i.test(raw)) return null;
  return raw.split('/').some((segment) => segment === '..' || segment === '.') ? null : raw;
};

/** `Range` do navegador repassado só se for `bytes=a-b`; qualquer outro valor é descartado em vez de repassado. */
export const safeRange = (range: string | undefined): string | undefined => (range && RANGE_RE.test(range) ? range : undefined);

const authRefused = (service: Service): SourceError => new SourceError(`${service.secretLabel} recusado pelo ${service.name} — confira em Conexões`, 409);

/** Falha de rede, recusa de conexão ou timeout: mensagem nossa, nunca o detalhe do erro. Redirect não é seguido (o token não sai do servidor). */
const send = async (url: URL, init: RequestInit): Promise<Response> => {
  try {
    return await fetchImpl(url, { ...init, redirect: 'manual' });
  } catch {
    throw new SourceError('não alcancei o servidor agora — confira o endereço em Conexões', 502);
  }
};

const expectOk = (res: Response, service: Service, notFound: string): void => {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) throw authRefused(service);
  if (res.status === 404) throw new SourceError(notFound, 404);
  throw new SourceError(`o ${service.name} respondeu ${res.status}`, 502);
};

/** JSON de uma chamada curta (listas, metadados). O timeout cobre cabeçalhos e corpo. */
export const getJson = async <T>(service: Service, url: URL, headers: Record<string, string>, notFound: string): Promise<T> => {
  const res = await send(url, { headers, signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  expectOk(res, service, notFound);
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError(`resposta inesperada do ${service.name}`, 502);
  }
};

/** Resposta de mídia: o timeout vale só até os cabeçalhos, o corpo do vídeo segue em stream sem ser cortado. */
export const getStream = async (service: Service, url: URL, headers: Record<string, string>): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await send(url, { headers, signal: controller.signal });
    if (res.status === 401 || res.status === 403) throw authRefused(service);
    return res;
  } finally {
    clearTimeout(timer);
  }
};

/** Lê o corpo com teto de bytes: passou do limite, para de ler e devolve null. */
export const readCapped = async (res: Response, max: number): Promise<Uint8Array | null> => {
  const declared = Number(res.headers.get('content-length'));
  const reader = res.body?.getReader();
  if (!reader || declared > max) {
    await reader?.cancel().catch(() => undefined);
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let chunk = await reader.read();
  while (!chunk.done) {
    total += chunk.value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(chunk.value);
    chunk = await reader.read();
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

/** Miniatura (jpeg/png validado depois por `saveThumb`). Qualquer falha vira null: capa é enriquecimento, não bloqueia a importação. */
export const getThumbBytes = async (url: URL, headers: Record<string, string>): Promise<Uint8Array | null> => {
  let res: Response;
  try {
    res = await send(url, { headers, signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  return readCapped(res, THUMB_MAX_BYTES);
};

export interface Page<T> {
  items: T[];
  /** Total informado pelo servidor; sem ele, uma página mais curta que o pedido marca o fim. */
  total?: number;
}

/** Junta páginas até `MAX_ITEMS`. Sempre limitado: no máximo três requisições para o teto de 500. */
export const collectPages = async <T>(fetchPage: (start: number, size: number) => Promise<Page<T>>): Promise<T[]> => {
  const out: T[] = [];
  let start = 0;
  // Teto também de requisições: páginas curtas com total enorme não podem virar centenas de chamadas.
  for (let request = 0; request < MAX_PAGES && out.length < MAX_ITEMS; request++) {
    const size = Math.min(PAGE_SIZE, MAX_ITEMS - out.length);
    const page = await fetchPage(start, size);
    out.push(...page.items);
    start += page.items.length;
    const done = page.total !== undefined ? start >= page.total : page.items.length < size;
    if (done || page.items.length === 0) break;
  }
  return out.slice(0, MAX_ITEMS);
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Episódio vira "Série SxxEyy — Nome"; sem a série ou sem temporada/episódio, fica só o nome. */
export const episodeCaption = (series: string | undefined, season: number | undefined, episode: number | undefined, title: string): string => {
  const code = typeof season === 'number' && typeof episode === 'number' ? ` S${pad(season)}E${pad(episode)}` : '';
  return series ? `${series}${code} — ${title}` : title;
};

/** Duração em segundos a partir de uma unidade do servidor (ticks de 100 ns no Jellyfin, ms no Plex). */
export const durationSeconds = (value: number | undefined, unitsPerSecond: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value / unitsPerSecond);
};
