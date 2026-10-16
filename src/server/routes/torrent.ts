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
  openTorrentStream,
  resolveStreamTarget,
  torrentStatus,
} from '../torrent/engine.ts';

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
 * Interpreta o `Range`. Devolve `null` para "sem range" (200 no arquivo inteiro) e `'unsatisfiable'`
 * quando o range é sintaticamente válido mas não pode ser servido (416).
 *
 * Cobre o que o player realmente manda: `bytes=N-`, `bytes=N-M` e `bytes=-N` (últimos N bytes, que é
 * como vários navegadores leem o fim de um MP4 para achar o átomo `moov`). Range invertido
 * (`bytes=500-100`) passa na sintaxe mas não é satisfazível — sem essa guarda a resposta saía com
 * 206, `Content-Range` inválido e `Content-Length` negativo.
 */
export const parseRange = (
  header: string | undefined,
  totalSize: number,
): { start: number; end: number } | 'unsatisfiable' | null => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // Sufixo: `bytes=-N` são os últimos N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, totalSize - suffix), end: totalSize - 1 };
  }

  const start = Number(rawStart);
  if (start >= totalSize) return 'unsatisfiable';
  const end = rawEnd === '' ? totalSize - 1 : Math.min(Number(rawEnd), totalSize - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
};

/**
 * Streaming com `Range`. Mesmo contrato do player do Telegram (`routes/telegram.ts`): 206 com
 * `Content-Range` quando o cliente pede um trecho, 200 no arquivo inteiro, 416 quando o range não
 * é satisfazível. É o que faz o scrub da barra de progresso funcionar via seek.
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

  const range = parseRange(c.req.header('Range'), target.length);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${target.length}` } });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? target.length - 1;

  const headers: Record<string, string> = {
    'Content-Type': target.contentType,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${target.length}`;

  // HEAD devolve só os cabeçalhos: montar o stream selecionaria pedaços à toa, sem ninguém ler.
  if (c.req.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });

  const stream = openTorrentStream(infoHash, fileIndex, start, end);
  if (!stream) return Response.json({ error: 'torrent não está aberto' }, { status: 404 });
  return new Response(stream, { status: range ? 206 : 200, headers });
};

// Só GET: o Hono despacha HEAD para o handler de GET mantendo `c.req.method === 'HEAD'`, que é o
// que a guarda acima usa. Registrar 'HEAD' separado seria código morto.
torrentRoutes.on('GET', '/:infoHash/stream/:fileIndex', streamHandler);
