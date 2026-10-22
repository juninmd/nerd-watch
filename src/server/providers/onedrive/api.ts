import type { NewTelegramItem } from '../../repo/telegram.ts';
import { fetchHeaders, isHttpsUrl, plainFetch, readCapped, THUMB_MAX_BYTES } from '../sources/http.ts';
import { relayMedia, syntheticMessageId, titleFromFilename, VIDEO_EXT } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { onedriveOAuth } from './oauth.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const MAX_FILES = 500;
export const NOT_FOUND_FOLDER = 'pasta não encontrada no OneDrive (confira o caminho e se a sua conta tem acesso)';
export const NOT_FOUND_FILE = 'vídeo não encontrado nessa pasta do OneDrive';

/** ID de item do Graph (ex.: `01BYE5…` ou `D4A7…!123` em contas pessoais); só esses caracteres entram na URL. */
export const ITEM_ID_RE = /^[A-Za-z0-9!_-]{5,100}$/;

interface GraphItem {
  id?: string;
  name?: string;
  createdDateTime?: string;
  folder?: unknown;
  file?: { mimeType?: string };
  video?: { duration?: number };
  '@microsoft.graph.downloadUrl'?: string;
}

interface GraphPage {
  value?: GraphItem[];
  '@odata.nextLink'?: string;
}

export interface OneDriveVideo {
  id: string;
  name: string;
  createdDateTime?: string;
  duration?: number;
}

const FORBIDDEN = new Set(['\\', '?', '#', '%', ':']);
const hasForbiddenChar = (segment: string): boolean => [...segment].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || FORBIDDEN.has(ch));

/**
 * Caminho de pasta digitado pelo usuário (`/Vídeos/Filmes`). Devolve os segmentos; `[]` é a raiz. Recusa `.`/`..` e
 * tudo que mudaria a URL do Graph (`?`, `#`, `%`, `:`, barra invertida, controle).
 */
export const parseFolderPath = (input: string): string[] | null => {
  const text = input.trim();
  if (!text || text.length > 400) return null;
  const segments = text.split('/').filter(Boolean);
  const bad = segments.some((s) => s === '.' || s === '..' || s.trim() !== s || hasForbiddenChar(s));
  return bad ? null : segments;
};

const encodedPath = (segments: string[]): string => segments.map(encodeURIComponent).join('/');
/** Metadados da pasta: `root:/a/b` (sem `:` final, que é só para acessar filhos). */
export const folderMetaUrl = (segments: string[]): string => (segments.length ? `${GRAPH}/me/drive/root:/${encodedPath(segments)}` : `${GRAPH}/me/drive/root`);
export const childrenUrl = (segments: string[]): string =>
  segments.length ? `${GRAPH}/me/drive/root:/${encodedPath(segments)}:/children` : `${GRAPH}/me/drive/root/children`;

const serviceError = (status: number, notFound: string): SourceError =>
  status === 404 ? new SourceError(notFound, 404) : new SourceError(`o OneDrive respondeu ${status}`, 502);

/** GET autenticado. Redirect não é seguido (o Bearer não pode viajar para outra origem). */
const graphJson = async <T>(url: string, notFound: string): Promise<T> => {
  const res = await onedriveOAuth.authedFetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw serviceError(res.status, notFound);
  return (await res.json()) as T;
};

/** `@odata.nextLink` vem do servidor, mas só seguimos se continuar sendo o Graph (senão o Bearer vazaria). */
const nextLinkOf = (link: string): string => {
  try {
    const url = new URL(link);
    if (url.origin === GRAPH_ORIGIN) return url.toString();
  } catch {
    // cai no erro abaixo
  }
  throw new SourceError('resposta inesperada do OneDrive', 502);
};

const isVideo = (item: GraphItem): item is GraphItem & { id: string; name: string; file: { mimeType?: string } } =>
  item.file !== undefined &&
  typeof item.id === 'string' &&
  ITEM_ID_RE.test(item.id) &&
  typeof item.name === 'string' &&
  (item.file.mimeType?.startsWith('video/') === true || VIDEO_EXT.test(item.name));

/** Metadados da pasta (resolve): precisa existir e ser pasta. */
export const getFolder = async (segments: string[]): Promise<{ name: string }> => {
  const item = await graphJson<GraphItem>(`${folderMetaUrl(segments)}?$select=id,name,folder`, NOT_FOUND_FOLDER);
  if (!item.folder) throw new SourceError(NOT_FOUND_FOLDER, 404);
  return { name: item.name ?? 'OneDrive' };
};

/** Vídeos diretamente na pasta, do mais novo ao mais antigo (teto de `MAX_FILES`; páginas limitadas por `MAX_PAGES`). */
export const listFolderVideos = async (segments: string[]): Promise<OneDriveVideo[]> => {
  const videos: OneDriveVideo[] = [];
  let next: string | undefined = `${childrenUrl(segments)}?$top=${PAGE_SIZE}&$select=id,name,file,video,createdDateTime`;
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const page: GraphPage = await graphJson<GraphPage>(next, NOT_FOUND_FOLDER);
    for (const item of page.value ?? []) {
      if (isVideo(item)) videos.push({ id: item.id, name: item.name, createdDateTime: item.createdDateTime, duration: item.video?.duration });
    }
    next = page['@odata.nextLink'] ? nextLinkOf(page['@odata.nextLink']) : undefined;
  }
  return videos.sort((a, b) => (b.createdDateTime ?? '').localeCompare(a.createdDateTime ?? '')).slice(0, MAX_FILES);
};

export const toItems = (videos: OneDriveVideo[]): NewTelegramItem[] =>
  videos.map((v) => ({
    messageId: syntheticMessageId(v.createdDateTime, v.id),
    caption: titleFromFilename(v.name),
    // `video.duration` vem em milissegundos.
    durationSeconds: typeof v.duration === 'number' && v.duration > 0 ? Math.round(v.duration / 1000) : null,
    thumbnailUrl: null,
    postedAt: v.createdDateTime ?? null,
    fileRef: v.id,
  }));

/**
 * Reprodução: resolve o `@microsoft.graph.downloadUrl` (pré-autenticado, curta duração) a cada play e busca com
 * `Range` SEM `Authorization`. Nada de link expirável guardado no banco.
 */
export const streamOneDriveFile = async (fileRef: string, range: string | undefined): Promise<Response> => {
  const item = await graphJson<GraphItem>(`${GRAPH}/me/drive/items/${fileRef}?select=id,@microsoft.graph.downloadUrl`, NOT_FOUND_FILE);
  const link = item['@microsoft.graph.downloadUrl'];
  if (!link || !isHttpsUrl(link)) throw new SourceError('o OneDrive não devolveu o link de reprodução', 502);
  const upstream = await fetchHeaders(plainFetch, link, { headers: range ? { Range: range } : {}, redirect: 'manual' }, 30_000);
  return relayMedia(upstream, NOT_FOUND_FILE);
};

/**
 * Miniatura média: o Graph responde 302 para uma URL pré-autenticada; seguimos essa URL SEM `Authorization`.
 * Qualquer falha vira null (miniatura é opcional).
 */
export const downloadOneDriveThumb = async (fileRef: string): Promise<Uint8Array | null> => {
  if (!ITEM_ID_RE.test(fileRef)) return null;
  const res = await onedriveOAuth.authedFetch(`${GRAPH}/me/drive/items/${fileRef}/thumbnails/0/medium/content`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return readCapped(res, THUMB_MAX_BYTES);
  const location = res.headers.get('location');
  if (res.status < 300 || res.status >= 400 || !location || !isHttpsUrl(location)) return null;
  const image = await plainFetch(location, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  return image.ok ? readCapped(image, THUMB_MAX_BYTES) : null;
};
