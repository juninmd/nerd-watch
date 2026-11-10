import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { MiddlewareHandler } from 'hono';

/**
 * Arquivos estáticos do cliente (`public/`, gerado por `scripts/build-client.ts`).
 *
 * - `/assets/*` tem hash do conteúdo no nome: vai com `immutable`, e a revisita não gera requisição nenhuma.
 * - O resto (`index.html`, `sw.js`, manifesto) vai com `no-cache` + `ETag`: o navegador revalida e recebe 304.
 * - Se o build deixou `arquivo.br` ou `arquivo.gz` ao lado, o servidor entrega o pré-comprimido que o
 *   navegador aceitar. Nada é comprimido por requisição.
 *
 * Sem índice em memória de propósito: um `bun run build:client` com o servidor no ar troca os nomes dos
 * arquivos, e três `stat` por requisição custam microssegundos.
 */

const IMMUTABLE_PREFIX = '/assets/';
const ONE_YEAR = 'public, max-age=31536000, immutable';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  png: 'image/png',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
};

/** Só arquivo regular conta; diretório, link quebrado e erro de leitura viram "não existe". */
const fileStat = async (path: string): Promise<{ size: number; mtimeMs: number } | null> => {
  try {
    const s = await stat(path);
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  }
};

/**
 * Caminho no disco para um pathname de URL, ou `null` se ele sai da raiz. O `resolve` normaliza `..` e o prefixo
 * com separador garante que `/public-evil` não passe por `/public`.
 */
export const resolveStaticPath = (root: string, pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const base = resolve(root);
  const full = resolve(base, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  return full.startsWith(base + sep) ? full : null;
};

/** `Accept-Encoding` → codificações aceitas (ignora as com `q=0`). */
export const acceptedEncodings = (header: string | undefined): Set<string> => {
  const accepted = new Set<string>();
  for (const part of (header ?? '').split(',')) {
    const [name = '', ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (name && !(q && Number(q.slice(2)) === 0)) accepted.add(name);
  }
  return accepted;
};

/** `If-None-Match` casa com a ETag atual (comparação fraca: o prefixo `W/` não importa). */
const etagMatches = (header: string | undefined, etag: string): boolean => {
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some((candidate) => {
    const c = candidate.trim();
    return c === '*' || c.replace(/^W\//, '') === bare;
  });
};

export const createStaticHandler = (root: string): MiddlewareHandler => async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD') return next();

  const pathname = c.req.path === '/' ? '/index.html' : c.req.path;
  const full = resolveStaticPath(root, pathname);
  const info = full ? await fileStat(full) : null;
  if (!full || !info) return next();

  const ext = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
  const etag = `W/"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
  const headers = new Headers({
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': pathname.startsWith(IMMUTABLE_PREFIX) ? ONE_YEAR : 'no-cache',
    ETag: etag,
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
  });
  if (etagMatches(c.req.header('If-None-Match'), etag)) return new Response(null, { status: 304, headers });

  const accepted = acceptedEncodings(c.req.header('Accept-Encoding'));
  let body = full;
  let size = info.size;
  for (const [encoding, suffix] of [
    ['br', '.br'],
    ['gzip', '.gz'],
  ] as const) {
    if (!accepted.has(encoding)) continue;
    const variant = await fileStat(full + suffix);
    // Variante mais velha que o original sobrou de um build anterior: não serve.
    if (!variant || variant.mtimeMs < info.mtimeMs) continue;
    headers.set('Content-Encoding', encoding);
    body = full + suffix;
    size = variant.size;
    break;
  }
  headers.set('Content-Length', String(size));
  return new Response(method === 'HEAD' ? null : Bun.file(body), { status: 200, headers });
};
