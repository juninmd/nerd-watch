import type { NewTelegramItem } from '../../repo/telegram.ts';
import { type Fetcher, fetchHeaders, readTextLimited } from '../sources/http.ts';
import { isSafeRemotePath, normalizeRemotePath } from '../sources/paths.ts';
import { VIDEO_EXT, relayMedia, syntheticMessageId, titleFromFilename } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { childText, childrenNamed, findAll, parseXml } from '../xml/minixml.ts';
import { type WebdavConfig, webdavConfig } from './config.ts';

/** Teto de 2 níveis de subpastas: a pasta do canal (nível 0) e os dois níveis abaixo dela. */
const MAX_DEPTH = 2;
const MAX_REQUESTS = 40;
const MAX_FILES = 5000;
const MAX_ITEMS = 500;
const MAX_BODY = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>';

let doFetch: Fetcher = (input, init) => fetch(input, init);

/** Só para testes: troca o `fetch` por um falso (o padrão do Drive). `null` volta ao real. */
export const setWebdavFetchForTests = (fn: Fetcher | null): void => {
  doFetch = fn ?? ((input, init) => fetch(input, init));
};

interface DavEntry {
  path: string;
  collection: boolean;
  modified: string | null;
}

const basicAuth = (cfg: WebdavConfig): string => `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}`;

/** URL de um caminho do servidor. Só recebe caminho já validado por `isSafeRemotePath`. */
const davUrl = (cfg: WebdavConfig, path: string): string => `${cfg.origin}${cfg.basePath}${normalizeRemotePath(path).split('/').map(encodeURIComponent).join('/')}`;

/**
 * Uma requisição autenticada. Redirect nunca é seguido (o `Authorization` não pode ir para outra origem): o endereço
 * configurado precisa ser o final. Erros viram mensagem nossa, sem o corpo do servidor.
 */
const send = async (cfg: WebdavConfig, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Response> => {
  const res = await fetchHeaders(doFetch, davUrl(cfg, path), { method, redirect: 'manual', body, headers: { Authorization: basicAuth(cfg), ...headers } }, TIMEOUT_MS).catch(() => {
    throw new SourceError('não foi possível falar com o WebDAV agora', 502);
  });
  if (res.status >= 300 && res.status < 400) throw new SourceError('o WebDAV redirecionou; ajuste WEBDAV_URL para o endereço final', 502);
  if (res.status === 401 || res.status === 403) throw new SourceError('o WebDAV recusou o usuário e a senha', 409);
  return res;
};

/** `href` do multistatus (caminho ou URL absoluta) -> caminho do servidor. Null para o que escapa do servidor configurado. */
export const hrefToPath = (href: string, cfg: WebdavConfig): string | null => {
  let pathname: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(href)) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.origin !== cfg.origin) return null;
    pathname = url.pathname;
  } else {
    pathname = href;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith(`${cfg.basePath}/`)) return null;
  const path = normalizeRemotePath(decoded.slice(cfg.basePath.length));
  return isSafeRemotePath(path) ? path : null;
};

const isSuccess = (status: string | undefined): boolean => /\b200\b/.test(status ?? '');

/** Entradas do multistatus; só propriedades que vieram com status 200 contam (o resto é 404 do próprio servidor). */
export const parseMultistatus = (xml: string, cfg: WebdavConfig): DavEntry[] => {
  const entries: DavEntry[] = [];
  for (const response of findAll(parseXml(xml), 'response')) {
    const path = hrefToPath(childText(response, 'href') ?? '', cfg);
    if (!path) continue;
    const entry: DavEntry = { path, collection: false, modified: null };
    for (const propstat of childrenNamed(response, 'propstat')) {
      if (!isSuccess(childText(propstat, 'status'))) continue;
      const prop = childrenNamed(propstat, 'prop')[0];
      if (!prop) continue;
      entry.collection = childrenNamed(prop, 'resourcetype').some((rt) => childrenNamed(rt, 'collection').length > 0);
      const modified = Date.parse(childText(prop, 'getlastmodified') ?? '');
      entry.modified = Number.isFinite(modified) ? new Date(modified).toISOString() : null;
    }
    entries.push(entry);
  }
  return entries;
};

const propfind = async (cfg: WebdavConfig, path: string, depth: '0' | '1'): Promise<DavEntry[]> => {
  const res = await send(cfg, 'PROPFIND', path, { Depth: depth, 'Content-Type': 'application/xml' }, PROPFIND_BODY);
  if (res.status === 404) throw new SourceError('pasta não encontrada no WebDAV (confira o caminho)', 404);
  if (res.status !== 207 && res.status !== 200) throw new SourceError(`o WebDAV respondeu ${res.status}`, 502);
  const xml = await readTextLimited(res, MAX_BODY).catch(() => {
    throw new SourceError('resposta do WebDAV grande demais', 502);
  });
  try {
    return parseMultistatus(xml, cfg);
  } catch {
    throw new SourceError('resposta do WebDAV inválida', 502);
  }
};

const childPrefix = (folder: string): string => (folder === '/' ? '/' : `${folder}/`);

/** Vídeos da pasta e de até `MAX_DEPTH` níveis de subpastas, do mais novo ao mais antigo (teto de `MAX_ITEMS`). */
export const listVideos = async (cfg: WebdavConfig, folder: string): Promise<NewTelegramItem[]> => {
  const files: Array<{ path: string; modified: string | null }> = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: folder, depth: 0 }];
  for (let requests = 0; queue.length > 0 && requests < MAX_REQUESTS && files.length < MAX_FILES; requests++) {
    const dir = queue.shift() as { path: string; depth: number };
    for (const entry of await propfind(cfg, dir.path, '1')) {
      // Só filhos diretos da pasta pedida: um servidor que devolve irmãos ou o próprio diretório é ignorado.
      if (entry.path === dir.path || !entry.path.startsWith(childPrefix(dir.path))) continue;
      if (entry.collection) {
        if (dir.depth < MAX_DEPTH) queue.push({ path: entry.path, depth: dir.depth + 1 });
      } else if (VIDEO_EXT.test(entry.path)) files.push({ path: entry.path, modified: entry.modified });
    }
  }
  const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
  return files
    .sort((a, b) => time(b.modified) - time(a.modified))
    .slice(0, MAX_ITEMS)
    .map((f) => ({
      messageId: syntheticMessageId(f.modified, f.path),
      caption: titleFromFilename(f.path.slice(f.path.lastIndexOf('/') + 1)),
      postedAt: f.modified,
      fileRef: f.path,
    }));
};

/** Valida o que o usuário digitou (caminho na raiz do servidor) e confirma que é uma pasta. */
export const resolveFolder = async (input: string): Promise<{ handle: string; name: string }> => {
  const text = input.trim();
  if (!text.startsWith('/')) throw new SourceError('informe o caminho da pasta na raiz do servidor (ex.: /Videos/Anime)', 400);
  const path = normalizeRemotePath(text);
  if (!isSafeRemotePath(path)) throw new SourceError('caminho inválido', 400);
  const cfg = webdavConfig();
  const self = (await propfind(cfg, path, '0')).find((e) => e.path === path);
  if (!self?.collection) throw new SourceError('o caminho não é uma pasta do WebDAV', 400);
  const name = path === '/' ? 'WebDAV' : (path.slice(path.lastIndexOf('/') + 1) as string);
  return { handle: `webdav:${path}`, name };
};

/** Handle `webdav:/caminho` -> caminho da pasta, ou null se o handle não for deste provider. */
export const folderOfHandle = (handle: string): string | null => {
  if (!handle.startsWith('webdav:')) return null;
  const folder = handle.slice('webdav:'.length);
  return isSafeRemotePath(folder) ? folder : null;
};

/** Proxy do vídeo com Range: o usuário e a senha só saem para o servidor configurado. */
export const openVideo = async (folder: string, fileRef: string, range: string | undefined): Promise<Response> => {
  const cfg = webdavConfig();
  if (!isSafeRemotePath(fileRef) || !fileRef.startsWith(childPrefix(folder)) || !VIDEO_EXT.test(fileRef)) throw new SourceError('vídeo não encontrado nessa pasta', 404);
  const res = await send(cfg, 'GET', fileRef, range ? { Range: range } : {});
  return relayMedia(res, 'vídeo não encontrado no WebDAV');
};
