import { randomBytes } from 'node:crypto';
import { safeRange } from '../providers/sources/http.ts';
import type { CastDevice } from './dlna-xml.ts';
import { renderTvWatchPage } from './tv-page.ts';

const MAX_SESSIONS = 10;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TTL_MS = 6 * 60 * 60_000;
const MAX_EXTERNAL_REDIRECTS = 4;
const EXTERNAL_HEAD_TIMEOUT_MS = 20_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DLNA_FEATURES = 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';
const TOKEN_RE = /^[a-f0-9]{32}$/;

export interface CastSessionInput {
  mediaSrc: string;
  title: string;
  subtitle?: string;
  poster?: string | null;
  mimeType?: string;
  subtitleVtt?: string | null;
  startAt?: number;
  device?: CastDevice | null;
}

export interface CastSession {
  id: string;
  token: string;
  mediaSrc: string;
  title: string;
  subtitle: string;
  poster: string | null;
  mimeType: string;
  subtitleVtt: string | null;
  startAt: number;
  device: CastDevice | null;
  createdAt: number;
  lastActivityAt: number;
}

export interface CastRelayOptions {
  /** Porta preferida; `0` escolhe uma porta livre automaticamente. */
  port?: number;
  /** Host de bind; padrão `0.0.0.0` (testes podem passar `127.0.0.1`). */
  hostname?: string;
  /** Despacha caminhos internos (`/api/...`) direto na aplicação Hono sem passar pela rede. */
  internalFetch: (req: Request) => Promise<Response> | Response;
  /** Fetch para URLs externas `http(s)://`. */
  externalFetch?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
}

export interface CastRelay {
  createSession(input: CastSessionInput): CastSession;
  getSession(id: string): CastSession | undefined;
  listSessions(): CastSession[];
  removeSession(id: string): boolean;
  /** Garante que o servidor HTTP da LAN esteja escutando e devolve a porta ativa. */
  ensureStarted(): number;
  port(): number | null;
  stop(): void;
  /** Handler HTTP exposto também para testes diretos sem socket. */
  handleRequest(req: Request): Promise<Response>;
}

const SAFE_INTERNAL_MEDIA_PATH =
  /^\/api\/(?:telegram\/(?:channels\/[^/]+\/(?:photo|items\/[^/]+\/(?:play|thumb))|[^/]+\/items\/[^/]+\/stream)|torrent\/[^/]+\/stream(?:\/[^/]+)?|media\/[^/]+\/[^/]+\/(?:file|live)|sources\/[^/]+\/stream)$/;

const isBlockedExternalHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '::' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.startsWith('::ffff:127.') ||
    host.startsWith('::ffff:169.254.') ||
    host.startsWith('fe80:') ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('169.254.')
  );
};

/**
 * Só aceita rotas internas de mídia/pôster da API (allowlist, nunca `/api/backup`, `/api/credentials`,
 * etc., nem traversal cru ou percent-encoded) ou URL HTTP(S) sem credenciais embutidas nem loopback.
 * Recusa `file:`, `javascript:`, `data:` e caminhos fora das rotas de mídia.
 */
export const isSafeMediaSrc = (src: string): boolean => {
  const trimmed = src.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n\0\\]/.test(trimmed)) return false;
  if (trimmed.startsWith('/api/')) {
    if (trimmed.startsWith('//') || trimmed.includes('#')) return false;
    const rawPath = trimmed.split('?')[0] ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return false;
    }
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('//')) return false;
    if (decoded.split('/').some((seg) => seg === '..' || seg === '.')) return false;
    return SAFE_INTERNAL_MEDIA_PATH.test(decoded);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (isBlockedExternalHost(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
};

const guessMimeType = (src: string, explicit?: string): string => {
  if (explicit && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(explicit.trim())) return explicit.trim();
  const path = src.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mkv')) return 'video/x-matroska';
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.ogg') || path.endsWith('.ogv')) return 'video/ogg';
  return 'video/mp4';
};

const copyMediaHeaders = (upstream: Response, fallbackMime: string): Headers => {
  const headers = new Headers();
  const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
  for (const name of passthrough) {
    const val = upstream.headers.get(name);
    if (val) headers.set(name, val);
  }
  if (!headers.has('content-type')) headers.set('content-type', fallbackMime);
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
  headers.set('transferMode.dlna.org', 'Streaming');
  headers.set('contentFeatures.dlna.org', DLNA_FEATURES);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'no-store');
  return headers;
};

const TV_PAGE_CSP =
  "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self' http: https:; img-src 'self' http: https: data:; object-src 'none'; frame-ancestors 'none'";

export const createCastRelay = (opts: CastRelayOptions): CastRelay => {
  const externalFetch = opts.externalFetch ?? fetch;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  const bindHost = opts.hostname ?? '0.0.0.0';
  const bindPort = opts.port ?? 0;

  const byId = new Map<string, CastSession>();
  const byToken = new Map<string, CastSession>();
  let server: ReturnType<typeof Bun.serve> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  const stopServerIfEmpty = (): void => {
    if (byId.size > 0) return;
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    if (server) {
      server.stop(true);
      server = null;
    }
  };

  const purgeExpired = (): void => {
    const cutoff = now() - ttlMs;
    for (const [id, session] of byId) {
      if (session.lastActivityAt < cutoff) {
        byId.delete(id);
        byToken.delete(session.token);
      }
    }
    stopServerIfEmpty();
  };

  const fetchExternal = async (startUrl: string, method: 'GET' | 'HEAD', headers: Headers): Promise<Response> => {
    let current = startUrl;
    for (let hop = 0; ; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EXTERNAL_HEAD_TIMEOUT_MS);
      let res: Response;
      try {
        // `manual`: cada redirecionamento precisa passar por `isSafeMediaSrc` (evita redirect para loopback/metadata).
        res = await externalFetch(current, { method, headers, redirect: 'manual', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!REDIRECT_STATUSES.has(res.status)) return res;
      await res.body?.cancel().catch(() => undefined);
      const location = res.headers.get('location');
      if (!location || hop >= MAX_EXTERNAL_REDIRECTS) throw new Error('redirecionamento inválido');
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        throw new Error('redirecionamento inválido');
      }
      if (!isSafeMediaSrc(next) || next.startsWith('/api/')) throw new Error('redirecionamento bloqueado');
      current = next;
    }
  };

  const proxyResource = async (req: Request, src: string, fallbackMime: string): Promise<Response> => {
    const forwardHeaders = new Headers();
    const range = safeRange(req.headers.get('range') ?? undefined);
    if (range) forwardHeaders.set('range', range);
    const ifRange = req.headers.get('if-range');
    if (ifRange) forwardHeaders.set('if-range', ifRange);
    const method = req.method === 'HEAD' ? 'HEAD' : 'GET';

    const upstream = src.startsWith('/api/')
      ? await opts.internalFetch(new Request(`http://127.0.0.1${src}`, { method, headers: forwardHeaders }))
      : await fetchExternal(src, method, forwardHeaders);

    const headers = copyMediaHeaders(upstream, fallbackMime);
    if (method === 'HEAD') {
      await upstream.body?.cancel().catch(() => undefined);
      return new Response(null, { status: upstream.status, headers });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  };

  const handleRequest = async (req: Request): Promise<Response> => {
    purgeExpired();
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
        },
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('método não permitido', { status: 405 });
    }

    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    // Formato único aceito: /s/<token>/<recurso>
    if (parts.length !== 3 || parts[0] !== 's') return new Response('não encontrado', { status: 404 });
    const [, token, resource] = parts as [string, string, string];
    if (!TOKEN_RE.test(token)) return new Response('não encontrado', { status: 404 });

    const session = byToken.get(token);
    if (!session) return new Response('sessão encerrada', { status: 404 });
    session.lastActivityAt = now();

    if (resource === 'media') {
      try {
        return await proxyResource(req, session.mediaSrc, session.mimeType);
      } catch {
        return new Response('falha ao ler a mídia', { status: 502 });
      }
    }

    if (resource === 'poster' && session.poster && isSafeMediaSrc(session.poster)) {
      try {
        return await proxyResource(req, session.poster, 'image/jpeg');
      } catch {
        return new Response('não encontrado', { status: 404 });
      }
    }

    if (resource === 'sub.vtt' && session.subtitleVtt) {
      const headers = {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      };
      return new Response(req.method === 'HEAD' ? null : session.subtitleVtt, { status: 200, headers });
    }

    if (resource === 'watch') {
      const base = `${url.protocol}//${url.host}/s/${session.token}`;
      const html = renderTvWatchPage({
        title: session.title,
        subtitle: session.subtitle,
        mediaUrl: `${base}/media`,
        subtitleUrl: session.subtitleVtt ? `${base}/sub.vtt` : null,
        posterUrl: session.poster && isSafeMediaSrc(session.poster) ? `${base}/poster` : null,
        startAt: session.startAt,
      });
      return new Response(req.method === 'HEAD' ? null : html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': TV_PAGE_CSP,
        },
      });
    }

    return new Response('não encontrado', { status: 404 });
  };

  const ensureStarted = (): number => {
    if (server) return server.port as number;
    server = Bun.serve({
      hostname: bindHost,
      port: bindPort,
      idleTimeout: 255,
      fetch: handleRequest,
    });
    sweepTimer = setInterval(purgeExpired, 5 * 60_000);
    sweepTimer.unref?.();
    return server.port as number;
  };

  const createSession = (input: CastSessionInput): CastSession => {
    purgeExpired();
    if (!isSafeMediaSrc(input.mediaSrc)) throw new Error('origem de vídeo inválida para transmissão');
    if (input.subtitleVtt && Buffer.byteLength(input.subtitleVtt, 'utf8') > MAX_SUBTITLE_BYTES) {
      throw new Error('legenda grande demais para transmissão');
    }
    // Limite de sessões simultâneas: remove a mais antiga antes de abrir nova.
    if (byId.size >= MAX_SESSIONS) {
      const oldest = [...byId.values()].sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
      if (oldest) {
        byId.delete(oldest.id);
        byToken.delete(oldest.token);
      }
    }
    const ts = now();
    const session: CastSession = {
      id: randomBytes(8).toString('hex'),
      token: randomBytes(16).toString('hex'),
      mediaSrc: input.mediaSrc.trim(),
      title: input.title.trim() || 'Vídeo',
      subtitle: input.subtitle?.trim() ?? '',
      poster: input.poster?.trim() || null,
      mimeType: guessMimeType(input.mediaSrc, input.mimeType),
      subtitleVtt: input.subtitleVtt ?? null,
      startAt: Number.isFinite(input.startAt) && (input.startAt ?? 0) > 0 ? Math.floor(input.startAt ?? 0) : 0,
      device: input.device ?? null,
      createdAt: ts,
      lastActivityAt: ts,
    };
    byId.set(session.id, session);
    byToken.set(session.token, session);
    return session;
  };

  const getSession = (id: string): CastSession | undefined => {
    purgeExpired();
    return byId.get(id);
  };

  const listSessions = (): CastSession[] => {
    purgeExpired();
    return [...byId.values()];
  };

  const removeSession = (id: string): boolean => {
    const existing = byId.get(id);
    if (!existing) return false;
    byId.delete(id);
    byToken.delete(existing.token);
    stopServerIfEmpty();
    return true;
  };

  const stop = (): void => {
    byId.clear();
    byToken.clear();
    stopServerIfEmpty();
  };

  return {
    createSession,
    getSession,
    listSessions,
    removeSession,
    ensureStarted,
    port: () => (server?.port ?? null),
    stop,
    handleRequest,
  };
};
