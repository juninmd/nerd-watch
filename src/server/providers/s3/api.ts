import type { NewTelegramItem } from '../../repo/telegram.ts';
import { type Fetcher, fetchHeaders, readTextLimited } from '../sources/http.ts';
import { isSafeRelativePath } from '../sources/paths.ts';
import { VIDEO_EXT, relayMedia, syntheticMessageId, titleFromFilename } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';
import { childText, childrenNamed, parseXml } from '../xml/minixml.ts';
import { type S3Config, s3Config } from './config.ts';
import { EMPTY_SHA256, amzDateOf, queryString, signV4, uriEncode } from './sigv4.ts';

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const MAX_PAGES = 20;
const MAX_SCAN = 20_000;
const MAX_ITEMS = 500;
const MAX_BODY = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

let doFetch: Fetcher = (input, init) => fetch(input, init);

/** Só para testes: troca o `fetch` por um falso. `null` volta ao real. */
export const setS3FetchForTests = (fn: Fetcher | null): void => {
  doFetch = fn ?? ((input, init) => fetch(input, init));
};

/** `bucket` ou `bucket/prefixo/` -> bucket e prefixo (sempre terminando em `/`, ou vazio). Null se inválido. */
export const parseLocation = (input: string): { bucket: string; prefix: string } | null => {
  const text = input.trim();
  const slash = text.indexOf('/');
  const bucket = slash === -1 ? text : text.slice(0, slash);
  const rest = slash === -1 ? '' : text.slice(slash + 1);
  if (!BUCKET_RE.test(bucket)) return null;
  const trimmed = rest.replace(/\/+$/, '');
  if (trimmed && !isSafeRelativePath(trimmed)) return null;
  return { bucket, prefix: trimmed ? `${trimmed}/` : '' };
};

/** Handle `s3:<bucket>/<prefixo>` (prefixo vazio na raiz do bucket). */
export const handleOf = (bucket: string, prefix: string): string => `s3:${bucket}/${prefix}`;

export const locationOfHandle = (handle: string): { bucket: string; prefix: string } | null => {
  if (!handle.startsWith('s3:')) return null;
  const body = handle.slice('s3:'.length);
  const slash = body.indexOf('/');
  if (slash === -1) return null;
  const bucket = body.slice(0, slash);
  const prefix = body.slice(slash + 1);
  if (!BUCKET_RE.test(bucket) || (prefix && !isSafeRelativePath(prefix.replace(/\/$/, '')))) return null;
  return { bucket, prefix };
};

const pathOf = (cfg: S3Config, bucket: string, key?: string): string => {
  const objectPath = key === undefined ? '/' : `/${key.split('/').map(uriEncode).join('/')}`;
  return `${cfg.basePath}/${uriEncode(bucket)}${objectPath}`;
};

/** GET assinado. A chave e o segredo só entram na assinatura, nunca em erro, log ou resposta. */
const signedGet = async (cfg: S3Config, path: string, query: Array<[string, string]>, range?: string): Promise<Response> => {
  const extra: Record<string, string> = range ? { Range: range } : {};
  const signed = signV4(
    { method: 'GET', host: new URL(cfg.origin).host, path, query, headers: extra, payloadHash: EMPTY_SHA256 },
    { accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region, service: 's3' },
    amzDateOf(new Date()),
  );
  const url = `${cfg.origin}${path}${query.length > 0 ? `?${queryString(query)}` : ''}`;
  const res = await fetchHeaders(doFetch, url, { method: 'GET', redirect: 'manual', headers: { ...extra, ...signed } }, TIMEOUT_MS).catch(() => {
    throw new SourceError('não foi possível falar com o S3 agora', 502);
  });
  if (res.status >= 300 && res.status < 400) throw new SourceError('o S3 redirecionou; confira o endpoint (use o endereço final)', 502);
  if (res.status === 401 || res.status === 403) throw new SourceError('o S3 recusou as credenciais (confira a chave, o segredo e a região)', 409);
  return res;
};

interface ListedObject {
  key: string;
  modified: string | null;
}

const listPage = async (cfg: S3Config, bucket: string, prefix: string, token: string | undefined): Promise<{ objects: ListedObject[]; next: string | null }> => {
  const query: Array<[string, string]> = [
    ['list-type', '2'],
    ['max-keys', '1000'],
    ['prefix', prefix],
  ];
  if (token) query.push(['continuation-token', token]);
  const res = await signedGet(cfg, pathOf(cfg, bucket), query);
  if (res.status === 404) throw new SourceError('bucket não encontrado no S3 (confira o nome)', 404);
  if (res.status !== 200) throw new SourceError(`o S3 respondeu ${res.status}`, 502);
  const xml = await readTextLimited(res, MAX_BODY).catch(() => {
    throw new SourceError('resposta do S3 grande demais', 502);
  });
  let root: ReturnType<typeof parseXml>;
  try {
    root = parseXml(xml);
  } catch {
    throw new SourceError('resposta do S3 inválida', 502);
  }
  const objects = childrenNamed(root, 'contents').map((c) => {
    const modified = Date.parse(childText(c, 'lastmodified') ?? '');
    return { key: childText(c, 'key') ?? '', modified: Number.isFinite(modified) ? new Date(modified).toISOString() : null };
  });
  const truncated = childText(root, 'istruncated') === 'true';
  const next = truncated ? (childText(root, 'nextcontinuationtoken') ?? null) : null;
  return { objects, next };
};

/** Confirma que o bucket existe e as chaves funcionam (uma página basta). Erros saem como `SourceError`. */
export const checkLocation = async (cfg: S3Config, bucket: string, prefix: string): Promise<void> => {
  await listPage(cfg, bucket, prefix, undefined);
};

/** Vídeos sob o prefixo (todos os níveis: o prefixo é a "pasta"), do mais novo ao mais antigo, com teto de páginas. */
export const listVideos = async (cfg: S3Config, bucket: string, prefix: string): Promise<NewTelegramItem[]> => {
  const found: ListedObject[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES && found.length < MAX_SCAN; page++) {
    const result = await listPage(cfg, bucket, prefix, token);
    found.push(...result.objects);
    if (!result.next) break;
    token = result.next;
  }
  const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
  return found
    .filter((o) => o.key.startsWith(prefix) && VIDEO_EXT.test(o.key) && isSafeRelativePath(o.key))
    .sort((a, b) => time(b.modified) - time(a.modified))
    .slice(0, MAX_ITEMS)
    .map((o) => ({
      messageId: syntheticMessageId(o.modified, o.key),
      caption: titleFromFilename(o.key.slice(o.key.lastIndexOf('/') + 1)),
      postedAt: o.modified,
      fileRef: o.key,
    }));
};

/** Proxy do vídeo com Range, assinado. O `fileRef` vem do banco, mas é validado de novo (tem que estar no prefixo). */
export const openVideo = async (bucket: string, prefix: string, key: string, range: string | undefined): Promise<Response> => {
  const cfg = s3Config();
  if (!isSafeRelativePath(key) || !key.startsWith(prefix) || !VIDEO_EXT.test(key)) throw new SourceError('vídeo não encontrado nesse canal', 404);
  const res = await signedGet(cfg, pathOf(cfg, bucket, key), [], range);
  return relayMedia(res, 'vídeo não encontrado no S3');
};
