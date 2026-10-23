import type { Context } from 'hono';
import { OpenSubtitlesRequestError } from '../providers/opensubtitles.ts';
import { resolveArchiveSubtitleUrl, resolveSubtitleFile } from '../providers/subtitles/index.ts';
import { loadSubtitleAsVtt, type SubtitleFailure } from '../subtitles/load.ts';
import type { MediaType } from '../types.ts';

/** Id do IMDb é `tt` + dígitos. Mesma regra de `subtitles.ts`. */
const IMDB_ID_RE = /^tt\d{7,10}$/;
/** Identificador de item do Internet Archive: letras, dígitos, ponto, hífen e sublinhado. */
const ARCHIVE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
/** Um pedido de legenda cabe folgado em 4 KB; o resto é abuso, não uso. */
const MAX_BODY_BYTES = 4096;

/** Lê o corpo até um teto, sem confiar em Content-Length (que pode faltar em transferência em partes). */
const readCapped = async (req: Request, max: number): Promise<string | null> => {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

/** Texto fixo por motivo: nunca repete mensagem ou HTML da fonte. */
export const subtitleFailureText = (reason: SubtitleFailure | 'empty' | 'no_cues'): string => {
  switch (reason) {
    case 'untrusted_url':
      return 'a fonte devolveu um endereço não permitido';
    case 'too_many_redirects':
      return 'a fonte redirecionou demais';
    case 'unreachable':
      return 'não foi possível baixar a legenda da fonte';
    case 'http_status':
      return 'a fonte não entregou a legenda';
    case 'too_large':
      return 'o arquivo de legenda é grande demais';
    case 'bad_type':
      return 'a fonte não entregou um arquivo de legenda de texto';
    case 'empty':
      return 'o arquivo de legenda está vazio';
    case 'no_cues':
      return 'não encontramos linhas de legenda neste arquivo';
  }
};

const parseMediaType = (raw: unknown): MediaType | undefined =>
  raw === 'tv' ? 'tv' : raw === 'movie' ? 'movie' : undefined;

/**
 * `POST /api/subtitles/vtt`: baixa a legenda escolhida e devolve WebVTT. Aceita o mesmo corpo do download
 * de addon (`source` + `id` + `imdbId`/`tmdbId`) ou `fileId` (OpenSubtitles), e `archiveId` para a legenda
 * que o próprio Internet Archive hospeda. Em todos os casos a URL sai do servidor, não do corpo do pedido.
 */
export const subtitleVttHandler = async (c: Context): Promise<Response> => {
  const raw = await readCapped(c.req.raw, MAX_BODY_BYTES);
  if (raw === null) return c.json({ error: 'pedido grande demais' }, 413);
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') return c.json({ error: 'corpo inválido' }, 400);

  let url: string;
  try {
    if (typeof body.archiveId === 'string') {
      if (!ARCHIVE_ID_RE.test(body.archiveId)) return c.json({ error: 'identificador do item inválido' }, 400);
      const found = await resolveArchiveSubtitleUrl(body.archiveId);
      if (!found) return c.json({ error: 'o Internet Archive não tem legenda para este item' }, 404);
      url = found;
    } else {
      const imdbId = typeof body.imdbId === 'string' && IMDB_ID_RE.test(body.imdbId) ? body.imdbId : undefined;
      const resolved = await resolveSubtitleFile({
        fileId: body.fileId === undefined ? undefined : (body.fileId as number),
        source: typeof body.source === 'string' ? body.source : undefined,
        id: typeof body.id === 'string' ? body.id : undefined,
        imdbId,
        tmdbId: Number.isInteger(body.tmdbId) ? (body.tmdbId as number) : undefined,
        mediaType: parseMediaType(body.mediaType),
        season: Number.isInteger(body.season) ? (body.season as number) : null,
        episode: Number.isInteger(body.episode) ? (body.episode as number) : null,
      });
      if (resolved.kind === 'invalid') return c.json({ error: 'pedido de legenda inválido' }, 400);
      if (resolved.kind === 'not_found')
        return c.json({ error: 'essa legenda não foi encontrada de novo na fonte' }, 404);
      url = resolved.url;
    }
  } catch (err) {
    if (err instanceof OpenSubtitlesRequestError) return c.json({ error: err.message }, err.status === 406 ? 429 : 502);
    return c.json({ error: 'a fonte de legendas não respondeu' }, 502);
  }

  const loaded = await loadSubtitleAsVtt(url);
  if (!loaded.ok) return c.json({ error: subtitleFailureText(loaded.reason) }, 502);
  return new Response(loaded.vtt, {
    status: 200,
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
