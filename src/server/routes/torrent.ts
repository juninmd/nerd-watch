import { type Context, Hono } from 'hono';
import { torrentEnabled } from '../config.ts';
import {
  TorrentDisabledError,
  TorrentInvalidIdentifierError,
  TorrentUnavailableError,
  closeTorrent,
  openArchiveTorrent,
  openTorrentStream,
  resolveStreamTarget,
  torrentStatus,
} from '../torrent/engine.ts';

export const torrentRoutes = new Hono();

torrentRoutes.post('/open', async (c) => {
  if (!torrentEnabled()) return c.json({ error: 'torrent desligado neste servidor' }, 501);

  const body = await c.req.json<{ identifier?: string; fileIndex?: number }>().catch(() => null);
  const identifier = body?.identifier?.trim();
  if (!identifier) return c.json({ error: 'identifier é obrigatório' }, 400);
  if (body?.fileIndex !== undefined && !Number.isInteger(body.fileIndex)) return c.json({ error: 'fileIndex inválido' }, 400);

  try {
    return c.json(await openArchiveTorrent(identifier, body?.fileIndex));
  } catch (err) {
    if (err instanceof TorrentInvalidIdentifierError) return c.json({ error: err.message }, 400);
    if (err instanceof TorrentDisabledError) return c.json({ error: err.message }, 501);
    if (err instanceof TorrentUnavailableError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

torrentRoutes.get('/:infoHash', (c) => {
  const infoHash = c.req.param('infoHash');
  const status = infoHash ? torrentStatus(infoHash) : null;
  if (!status) return c.json({ error: 'torrent não está aberto' }, 404);
  return c.json(status);
});

torrentRoutes.delete('/:infoHash', (c) => {
  const infoHash = c.req.param('infoHash');
  if (!infoHash || !closeTorrent(infoHash)) return c.json({ error: 'torrent não está aberto' }, 404);
  return c.json({ ok: true });
});

/**
 * Streaming com `Range`. Mesmo contrato do player do Telegram (`routes/telegram.ts`): 206 com
 * `Content-Range` quando o cliente pede um trecho, 200 no arquivo inteiro, 416 quando o range
 * não é satisfazível. É o que faz o scrub da barra de progresso funcionar via seek.
 *
 * O índice do arquivo vai no path (não em estado do servidor) para a URL identificar o recurso:
 * trocar de derivado na interface gera uma URL nova, sem corrida com o player pedindo bytes.
 */
const streamHandler = async (c: Context) => {
  const infoHash = c.req.param('infoHash');
  const fileIndex = Number(c.req.param('fileIndex'));
  if (!infoHash || !Number.isInteger(fileIndex)) return Response.json({ error: 'torrent não está aberto' }, { status: 404 });

  const target = resolveStreamTarget(infoHash, fileIndex);
  if (!target) return Response.json({ error: 'arquivo não tocável ou torrent não está aberto' }, { status: 404 });

  const rangeHeader = c.req.header('Range');
  const rangeMatch = rangeHeader ? /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim()) : null;
  const start = rangeMatch ? Number(rangeMatch[1]) : 0;

  if (start >= target.length) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${target.length}` } });
  }

  const requestedEnd = rangeMatch?.[2] ? Number(rangeMatch[2]) : target.length - 1;
  const end = Math.min(requestedEnd, target.length - 1);

  const headers: Record<string, string> = {
    'Content-Type': target.contentType,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
  };
  if (rangeMatch) headers['Content-Range'] = `bytes ${start}-${end}/${target.length}`;

  if (c.req.method === 'HEAD') return new Response(null, { status: rangeMatch ? 206 : 200, headers });

  const stream = openTorrentStream(infoHash, fileIndex, start, end);
  if (!stream) return Response.json({ error: 'torrent não está aberto' }, { status: 404 });
  return new Response(stream as unknown as ReadableStream, { status: rangeMatch ? 206 : 200, headers });
};

torrentRoutes.on('GET', '/:infoHash/stream/:fileIndex', streamHandler);
torrentRoutes.on('HEAD', '/:infoHash/stream/:fileIndex', streamHandler);
