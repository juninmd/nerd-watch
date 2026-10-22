import { isPlayableVideo } from '../media/playable.ts';
import { openTorrentStream, resolveStreamTarget } from './engine.ts';
import { parseRange } from './range.ts';

/**
 * Resposta HTTP de um arquivo do torrent aberto: 206 com `Content-Range` quando há range, 200 no
 * arquivo inteiro, 416 quando o range não é satisfazível. Compartilhada entre a rota de streaming
 * da Archive e o provider de torrent genérico, para que os dois falem o mesmo protocolo.
 *
 * `accept` decide quais nomes de arquivo são servíveis: a Archive só mostra o que o navegador toca;
 * o provider genérico também aceita containers que o navegador pode não tocar (ver docs).
 */
export const serveTorrentFile = (
  infoHash: string,
  fileIndex: number,
  rangeHeader: string | undefined,
  method: string,
  accept: (name: string) => boolean = isPlayableVideo,
): Response => {
  const target = resolveStreamTarget(infoHash, fileIndex, accept);
  if (!target) return Response.json({ error: 'arquivo não tocável ou torrent não está aberto' }, { status: 404 });

  const range = parseRange(rangeHeader, target.length);
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
  if (method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });

  const stream = openTorrentStream(infoHash, fileIndex, start, end);
  if (!stream) return Response.json({ error: 'torrent não está aberto' }, { status: 404 });
  return new Response(stream, { status: range ? 206 : 200, headers });
};
