import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { type BulkLibraryAction, bulkLibraryAction, listLibrary, removeLibraryEntry, upsertLibraryEntry, type LibraryItem } from '../repo/library.ts';
import { listUpNext } from '../repo/up-next.ts';
import { upsertTitle } from '../repo/titles.ts';
import { httpsUrlOrNull } from '../catalog-text.ts';
import { tmdbImageUrl } from '../providers/tmdb.ts';
import type { MediaType, TitleSource, WatchStatus } from '../types.ts';

export const libraryRoutes = new Hono();

const WATCH_STATUSES: WatchStatus[] = ['want', 'watching', 'watched', 'dropped'];
const isWatchStatus = (v: unknown): v is WatchStatus => typeof v === 'string' && WATCH_STATUSES.includes(v as WatchStatus);

/** Fontes que guardam a URL completa do pôster; as demais guardam só o caminho da TMDB. */
const ABSOLUTE_POSTER_SOURCES: ReadonlySet<TitleSource> = new Set(['archive', 'tvmaze', 'anilist']);

const posterUrl = (source: TitleSource, posterPath: string | null): string | null =>
  ABSOLUTE_POSTER_SOURCES.has(source) ? posterPath : tmdbImageUrl(posterPath, 'w342');

const posterUrlFor = (item: LibraryItem): string | null => posterUrl(item.title.source, item.title.poster_path);

const toResponse = (item: LibraryItem) => ({
  id: item.id,
  titleId: item.title_id,
  watchStatus: item.watch_status,
  rating: item.rating,
  notes: item.notes,
  currentSeason: item.current_season,
  currentEpisode: item.current_episode,
  addedAt: item.added_at,
  updatedAt: item.updated_at,
  title: {
    id: item.title.id,
    sourceId: item.title.source_id,
    source: item.title.source,
    mediaType: item.title.media_type,
    title: item.title.title,
    posterUrl: posterUrlFor(item),
    releaseDate: item.title.release_date,
    voteAverage: item.title.vote_average,
  },
});

libraryRoutes.get('/', async (c) => {
  const statusParam = c.req.query('status');
  if (statusParam && !isWatchStatus(statusParam)) return c.json({ error: 'status inválido' }, 400);
  const db = await getDb();
  const items = listLibrary(db, statusParam as WatchStatus | undefined);
  return c.json({ items: items.map(toResponse) });
});

const UP_NEXT_LIMIT_MAX = 50;

/** Séries em andamento com o próximo episódio não visto; ordenadas pela atividade da biblioteca. */
libraryRoutes.get('/up-next', async (c) => {
  const raw = c.req.query('limit');
  const limit = raw === undefined ? 12 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > UP_NEXT_LIMIT_MAX) return c.json({ error: `limit deve ser inteiro entre 1 e ${UP_NEXT_LIMIT_MAX}` }, 400);
  const rows = listUpNext(await getDb(), limit);
  return c.json({
    items: rows.map((r) => ({
      titleId: r.titleId,
      title: { sourceId: r.sourceId, source: r.source, mediaType: r.mediaType, title: r.title, posterUrl: posterUrl(r.source, r.posterPath) },
      seasonNumber: r.seasonNumber,
      episodeNumber: r.episodeNumber,
      episodeName: r.episodeName,
      runtime: r.runtime,
      activityAt: r.activityAt,
    })),
  });
});

interface AddLibraryBody {
  source: TitleSource;
  sourceId: string;
  mediaType: MediaType;
  title: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  voteAverage?: number;
  watchStatus?: WatchStatus;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

libraryRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<AddLibraryBody>>().catch(() => null);
  if (
    !body ||
    !isNonEmptyString(body.sourceId) ||
    !isNonEmptyString(body.title) ||
    (body.source !== 'tmdb' && body.source !== 'archive' && body.source !== 'tvmaze' && body.source !== 'anilist') ||
    (body.mediaType !== 'movie' && body.mediaType !== 'tv')
  ) {
    return c.json({ error: 'corpo inválido: source, sourceId, mediaType e title são obrigatórios' }, 400);
  }
  if (body.watchStatus && !isWatchStatus(body.watchStatus)) return c.json({ error: 'watchStatus inválido' }, 400);

  const db = await getDb();
  const titleRow = upsertTitle(db, {
    source: body.source,
    sourceId: body.sourceId,
    mediaType: body.mediaType,
    title: body.title,
    overview: body.overview ?? null,
    // Pôster de catálogo sem chave é URL completa: só https, para o navegador nunca receber outro esquema.
    posterPath: body.source === 'tvmaze' || body.source === 'anilist' ? httpsUrlOrNull(body.posterPath) : (body.posterPath ?? null),
    backdropPath: body.backdropPath ?? null,
    releaseDate: body.releaseDate ?? null,
    voteAverage: body.voteAverage ?? null,
  });
  const item = upsertLibraryEntry(db, titleRow.id, { watchStatus: body.watchStatus ?? 'want' });
  return c.json(toResponse(item), 201);
});

interface PatchLibraryBody {
  watchStatus?: WatchStatus;
  rating?: number | null;
  notes?: string | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
}

libraryRoutes.patch('/:titleId', async (c) => {
  const titleId = c.req.param('titleId');
  const body = await c.req.json<PatchLibraryBody>().catch(() => null);
  if (!body) return c.json({ error: 'corpo inválido' }, 400);
  if (body.watchStatus && !isWatchStatus(body.watchStatus)) return c.json({ error: 'watchStatus inválido' }, 400);
  if (body.rating != null && (body.rating < 0 || body.rating > 10)) return c.json({ error: 'rating deve ser 0-10' }, 400);

  const db = await getDb();
  const item = upsertLibraryEntry(db, titleId, body);
  return c.json(toResponse(item));
});

libraryRoutes.delete('/:entryId', async (c) => {
  const db = await getDb();
  removeLibraryEntry(db, c.req.param('entryId'));
  return c.body(null, 204);
});

const BULK_LIMIT = 500;

interface BulkBody {
  titleIds?: unknown;
  action?: unknown;
  watchStatus?: unknown;
}

libraryRoutes.post('/bulk', async (c) => {
  const body = await c.req.json<BulkBody>().catch(() => null);
  if (!body || !Array.isArray(body.titleIds) || !body.titleIds.every(isNonEmptyString)) return c.json({ error: 'titleIds deve ser uma lista de ids' }, 400);
  if (body.titleIds.length > BULK_LIMIT) return c.json({ error: `no máximo ${BULK_LIMIT} itens por vez` }, 400);

  let action: BulkLibraryAction;
  if (body.action === 'remove') action = { type: 'remove' };
  else if (body.action === 'status' && isWatchStatus(body.watchStatus)) action = { type: 'status', watchStatus: body.watchStatus };
  else return c.json({ error: 'action deve ser "remove" ou "status" (com watchStatus válido)' }, 400);

  const db = await getDb();
  return c.json({ affected: bulkLibraryAction(db, body.titleIds, action) });
});
