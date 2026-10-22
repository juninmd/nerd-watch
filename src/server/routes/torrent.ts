import { type Context, Hono } from 'hono';
import { torrentEnabled } from '../config.ts';
import {
  TorrentBadFileIndexError,
  TorrentDisabledError,
  TorrentInvalidIdentifierError,
  TorrentNoPlayableVideoError,
  TorrentUnavailableError,
  TorrentUntrustedSourceError,
  closeTorrent,
  openArchiveTorrent,
  torrentStatus,
} from '../torrent/engine.ts';
import { serveTorrentFile } from '../torrent/serve.ts';

export { parseRange } from '../torrent/range.ts';

export const torrentRoutes = new Hono();

torrentRoutes.post('/open', async (c) => {
  if (!torrentEnabled()) return c.json({ error: 'torrent desligado neste servidor' }, 501);

  const body = await c.req.json<{ identifier?: unknown; fileIndex?: unknown }>().catch(() => null);
  // `typeof` e não só truthiness: um JSON com número/array/bool derrubava o handler com 500.
  const identifier = typeof body?.identifier === 'string' ? body.identifier.trim() : '';
  if (!identifier) return c.json({ error: 'identifier é obrigatório' }, 400);
  if (body?.fileIndex !== undefined && !Number.isInteger(body.fileIndex)) return c.json({ error: 'fileIndex inválido' }, 400);

  try {
    return c.json(await openArchiveTorrent(identifier, body?.fileIndex as number | undefined));
  } catch (err) {
    if (err instanceof TorrentInvalidIdentifierError) return c.json({ error: err.message }, 400);
    if (err instanceof TorrentBadFileIndexError) return c.json({ error: err.message }, 400);
    if (err instanceof TorrentDisabledError) return c.json({ error: err.message }, 501);
    if (err instanceof TorrentNoPlayableVideoError) return c.json({ error: err.message }, 422);
    if (err instanceof TorrentUntrustedSourceError) return c.json({ error: err.message }, 502);
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
 * `Content-Range` quando o cliente pede um trecho, 200 no arquivo inteiro, 416 quando o range não
 * é satisfazível. É o que faz o scrub da barra de progresso funcionar via seek.
 *
 * O índice do arquivo vai no path (não em estado do servidor) para a URL identificar o recurso:
 * trocar de derivado na interface gera uma URL nova, sem corrida com o player pedindo bytes.
 */
const streamHandler = (c: Context) => {
  const infoHash = c.req.param('infoHash');
  const fileIndex = Number(c.req.param('fileIndex'));
  if (!infoHash || !Number.isInteger(fileIndex)) return Response.json({ error: 'torrent não está aberto' }, { status: 404 });
  return serveTorrentFile(infoHash, fileIndex, c.req.header('Range'), c.req.method);
};

// Só GET: o Hono despacha HEAD para o handler de GET mantendo `c.req.method === 'HEAD'`, que é o
// que `serveTorrentFile` usa. Registrar 'HEAD' separado seria código morto.
torrentRoutes.on('GET', '/:infoHash/stream/:fileIndex', streamHandler);
