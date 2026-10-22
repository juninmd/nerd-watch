import type { NewTelegramItem } from '../../repo/telegram.ts';
import { fetchHeaders, isHttpsUrl, plainFetch, readCapped, THUMB_MAX_BYTES } from '../sources/http.ts';
import { relayMedia, syntheticMessageId, titleFromFilename, VIDEO_EXT } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { dropboxOAuth } from './oauth.ts';

const RPC = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
const TIMEOUT_MS = 20_000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 50;
const MAX_FILES = 500;
export const NOT_FOUND_FOLDER = 'pasta não encontrada no Dropbox (confira o caminho e se a sua conta tem acesso)';
export const NOT_FOUND_FILE = 'vídeo não encontrado nessa pasta do Dropbox';

/** ID de arquivo do Dropbox (`id:…`); só esses caracteres entram em URL, cabeçalho e JSON. */
export const FILE_ID_RE = /^id:[A-Za-z0-9_-]{5,100}$/;

interface DropboxEntry {
  '.tag'?: string;
  id?: string;
  name?: string;
  client_modified?: string;
}

interface ListPage {
  entries?: DropboxEntry[];
  cursor?: string;
  has_more?: boolean;
}

export interface DropboxVideo {
  id: string;
  name: string;
  client_modified?: string;
}

const hasForbiddenChar = (segment: string): boolean => [...segment].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === '\\');

/** Caminho de pasta digitado pelo usuário, ex.: `/Vídeos`. Sem `.`/`..`, sem controle, sem barra invertida. */
export const normalizeFolderPath = (input: string): { path: string; name: string } | null => {
  const text = input.trim();
  if (!text || text.length > 1024) return null;
  const segments = text.split('/').filter(Boolean);
  const bad = segments.some((s) => s === '.' || s === '..' || s.trim() !== s || hasForbiddenChar(s));
  if (segments.length === 0 || bad) return null;
  return { path: `/${segments.join('/')}`, name: segments[segments.length - 1] as string };
};

/** Status do Dropbox -> mensagem nossa. O corpo do erro (que pode ter detalhes internos) nunca sai daqui. */
const serviceError = async (res: Response, notFound: string): Promise<SourceError> => {
  const body = (await res.json().catch(() => ({}))) as { error_summary?: unknown };
  const pathMissing = res.status === 409 && typeof body.error_summary === 'string' && body.error_summary.includes('not_found');
  return res.status === 404 || pathMissing ? new SourceError(notFound, 404) : new SourceError(`o Dropbox respondeu ${res.status}`, 502);
};

const rpc = async <T>(endpoint: string, body: unknown, notFound: string): Promise<T> => {
  const res = await dropboxOAuth.authedFetch(`${RPC}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await serviceError(res, notFound);
  return (await res.json()) as T;
};

const isVideo = (e: DropboxEntry): e is DropboxVideo =>
  e['.tag'] === 'file' && typeof e.id === 'string' && FILE_ID_RE.test(e.id) && typeof e.name === 'string' && VIDEO_EXT.test(e.name);

/** Vídeos diretamente na pasta, do mais novo ao mais antigo (teto de `MAX_FILES`; páginas limitadas por `MAX_PAGES`). */
export const listFolderVideos = async (path: string): Promise<DropboxVideo[]> => {
  const videos: DropboxVideo[] = [];
  let page = await rpc<ListPage>('files/list_folder', { path, recursive: false, limit: PAGE_LIMIT }, NOT_FOUND_FOLDER);
  for (let i = 1; ; i++) {
    videos.push(...(page.entries ?? []).filter(isVideo));
    if (!page.has_more || !page.cursor || i >= MAX_PAGES) break;
    page = await rpc<ListPage>('files/list_folder/continue', { cursor: page.cursor }, NOT_FOUND_FOLDER);
  }
  // ISO 8601 em UTC ordena corretamente como texto; evita parsear data à toa.
  return videos.sort((a, b) => (b.client_modified ?? '').localeCompare(a.client_modified ?? '')).slice(0, MAX_FILES);
};

export const toItems = (videos: DropboxVideo[]): NewTelegramItem[] =>
  videos.map((v) => ({
    messageId: syntheticMessageId(v.client_modified, v.id),
    caption: titleFromFilename(v.name),
    durationSeconds: null,
    // Miniatura vem por `downloadDropboxThumb` (pelo `fileRef`), nunca por URL guardada.
    thumbnailUrl: null,
    postedAt: v.client_modified ?? null,
    fileRef: v.id,
  }));

/** Link temporário (expira em ~4 h; depois 410). Resolvido a cada reprodução, nunca guardado no banco. */
const temporaryLink = async (fileRef: string): Promise<string> => {
  const res = await rpc<{ link?: string }>('files/get_temporary_link', { path: fileRef }, NOT_FOUND_FILE);
  if (!res.link || !isHttpsUrl(res.link)) throw new SourceError('o Dropbox não devolveu o link de reprodução', 502);
  return res.link;
};

/** Repassa o `Range` ao link temporário (sem `Authorization`: o link já é pré-autenticado) e devolve o corpo em stream. */
export const streamDropboxFile = async (fileRef: string, range: string | undefined): Promise<Response> => {
  const link = await temporaryLink(fileRef);
  const upstream = await fetchHeaders(plainFetch, link, { headers: range ? { Range: range } : {}, redirect: 'manual' }, 30_000);
  return relayMedia(upstream, NOT_FOUND_FILE);
};

/** Miniatura jpeg (w1024h768, teto de 2 MB). Null em qualquer falha: miniatura é opcional. */
export const downloadDropboxThumb = async (fileRef: string): Promise<Uint8Array | null> => {
  if (!FILE_ID_RE.test(fileRef)) return null;
  const arg = JSON.stringify({ resource: { '.tag': 'path', path: fileRef }, format: { '.tag': 'jpeg' }, size: { '.tag': 'w1024h768' } });
  const res = await dropboxOAuth.authedFetch(`${CONTENT}/files/get_thumbnail_v2`, {
    method: 'POST',
    headers: { 'Dropbox-API-Arg': arg },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok ? readCapped(res, THUMB_MAX_BYTES) : null;
};
