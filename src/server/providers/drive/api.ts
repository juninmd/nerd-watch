import { config } from '../../config.ts';
import type { NewTelegramItem } from '../../repo/telegram.ts';
import { fetchHeaders } from '../sources/http.ts';
import { DriveReauthRequiredError, driveFetch, getAccessToken, invalidateAccessToken } from './oauth.ts';

export class DriveFolderNotFoundError extends Error {
  constructor() {
    super('pasta não encontrada no Google Drive (confira o link e se a sua conta tem acesso)');
  }
}

const ID_RE = /^[A-Za-z0-9_-]{10,100}$/;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_FILES = 500;
const PAGE_SIZE = 200;

/** Aceita o link da pasta (`/drive/folders/<id>`, `?id=<id>`) ou o ID puro; qualquer outra coisa é inválida. */
export const parseFolderInput = (input: string): string | null => {
  const text = input.trim();
  if (ID_RE.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return null;
  const id = /\/folders\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
  return id && ID_RE.test(id) ? id : null;
};

export const folderLink = (folderId: string): string => `https://drive.google.com/drive/folders/${folderId}`;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  thumbnailLink?: string;
  videoMediaMetadata?: { durationMillis?: string };
}

const authedGet = async (url: URL): Promise<Response> => {
  const call = async () =>
    driveFetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` }, signal: AbortSignal.timeout(20_000) });
  const res = await call();
  if (res.status !== 401) return res;
  // Token revogado/vencido antes da hora: uma renovação forçada e uma segunda tentativa.
  invalidateAccessToken();
  return call();
};

const api = (path: string, params: Record<string, string>): URL => {
  const url = new URL(`${config.driveEndpoints.apiUrl}${path}`);
  url.search = new URLSearchParams({ supportsAllDrives: 'true', ...params }).toString();
  return url;
};

export const getFolderName = async (folderId: string): Promise<string> => {
  const res = await authedGet(api(`/files/${folderId}`, { fields: 'id,name,mimeType' }));
  if (res.status === 404 || res.status === 403) throw new DriveFolderNotFoundError();
  if (!res.ok) throw new Error(`o Google Drive respondeu ${res.status}`);
  const file = (await res.json()) as DriveFile;
  if (file.mimeType !== FOLDER_MIME) throw new DriveFolderNotFoundError();
  return file.name;
};

/** Vídeos diretamente dentro da pasta, do mais novo ao mais antigo (teto de `MAX_FILES`). */
export const listFolderVideos = async (folderId: string): Promise<DriveFile[]> => {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string> = {
      // `folderId` já passou por parseFolderInput (só [A-Za-z0-9_-]), então não há como escapar da aspa.
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`,
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,thumbnailLink,videoMediaMetadata(durationMillis))',
      orderBy: 'createdTime desc',
      pageSize: String(PAGE_SIZE),
      includeItemsFromAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;
    const res = await authedGet(api('/files', params));
    if (res.status === 404 || res.status === 403) throw new DriveFolderNotFoundError();
    if (!res.ok) throw new Error(`o Google Drive respondeu ${res.status}`);
    const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && files.length < MAX_FILES);
  return files.slice(0, MAX_FILES);
};

const hash3 = (text: string): number => {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return h;
};

/**
 * O resto do app ordena e navega por um `messageId` numérico que cresce com o tempo. Para arquivos do Drive ele vem
 * da data de criação (ms) e três dígitos estáveis derivados do ID do arquivo — o mesmo arquivo recebe sempre o mesmo
 * número entre sincronizações, e arquivos criados no mesmo milissegundo não colidem na prática.
 */
export const driveMessageId = (file: Pick<DriveFile, 'id' | 'createdTime'>): string => {
  const created = Date.parse(file.createdTime ?? '');
  return String((Number.isFinite(created) ? created : 0) * 1000 + hash3(file.id));
};

const titleOf = (name: string): string => name.replace(/\.[A-Za-z0-9]{2,5}$/, '').trim() || name;

export const toItems = (files: DriveFile[]): NewTelegramItem[] =>
  files.map((f) => {
    const millis = Number(f.videoMediaMetadata?.durationMillis);
    return {
      messageId: driveMessageId(f),
      caption: titleOf(f.name),
      durationSeconds: Number.isFinite(millis) && millis > 0 ? Math.round(millis / 1000) : null,
      // Link temporário do Google; `localizeThumbs` baixa e troca pela rota local logo depois.
      thumbnailUrl: f.thumbnailLink ?? null,
      postedAt: f.createdTime ?? null,
      fileRef: f.id,
    };
  });

const THUMB_HOST = /^lh\d*\.googleusercontent\.com$|^drive-thumbnail\.googleusercontent\.com$/;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/** Baixa a miniatura de um vídeo (host do Google validado: o token só vai para o Google). Null se falhar. */
export const downloadDriveThumb = async (thumbnailLink: string): Promise<Uint8Array | null> => {
  let url: URL;
  try {
    url = new URL(thumbnailLink);
  } catch {
    return null;
  }
  const fake = config.driveEndpoints.apiUrl !== 'https://www.googleapis.com/drive/v3';
  if (!fake && (url.protocol !== 'https:' || !THUMB_HOST.test(url.hostname))) return null;
  // O Google devolve `=s220`; um pouco maior fica nítido nos cards sem pesar.
  url.pathname = url.pathname.replace(/=s\d+$/, '=s480');
  const res = await authedGet(url).catch(() => null);
  if (!res?.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > 0 && bytes.length <= THUMB_MAX_BYTES ? bytes : null;
};

/** Repassa o `Range` do navegador ao Drive e devolve o corpo em stream (o token nunca sai do servidor). */
export const streamDriveFile = async (fileId: string, range: string | undefined): Promise<Response> => {
  const url = api(`/files/${fileId}`, { alt: 'media' });
  const call = async () =>
    fetchHeaders(driveFetch, url, { headers: { Authorization: `Bearer ${await getAccessToken()}`, ...(range ? { Range: range } : {}) } }, 30_000);
  let upstream = await call();
  if (upstream.status === 401) {
    invalidateAccessToken();
    upstream = await call();
  }
  if (upstream.status === 401) throw new DriveReauthRequiredError();

  if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 416) {
    return new Response(JSON.stringify({ error: upstream.status === 404 ? 'vídeo não encontrado no Google Drive' : `o Google Drive respondeu ${upstream.status}` }), {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const headers = new Headers();
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('accept-ranges')) headers.set('Accept-Ranges', 'bytes');
  return new Response(upstream.body, { status: upstream.status, headers });
};
