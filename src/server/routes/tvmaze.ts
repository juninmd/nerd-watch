import type { Database } from 'bun:sqlite';
import { Hono, type Context } from 'hono';
import { CatalogRequestError } from '../catalog-text.ts';
import { getDb } from '../db.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../repo/titles.ts';
import { TVMAZE_ATTRIBUTION, tvmazeSearchShows, tvmazeShowDetails, type TvmazeEpisode } from '../providers/tvmaze.ts';

export const tvmazeRoutes = new Hono();

const ID_RE = /^\d{1,10}$/;

/** Falha do catálogo vira a mensagem nossa com o status dele; qualquer outra exceção segue para o 500 do Hono. */
const providerError = (c: Context, err: unknown) => {
  if (err instanceof CatalogRequestError) return c.json({ error: err.message }, err.status as 404 | 429 | 502);
  throw err;
};

tvmazeRoutes.get('/search', async (c) => {
  const query = c.req.query('q')?.trim() ?? '';
  if (!query) return c.json({ error: 'parâmetro "q" é obrigatório' }, 400);
  try {
    return c.json({ results: await tvmazeSearchShows(query), attribution: TVMAZE_ATTRIBUTION });
  } catch (err) {
    return providerError(c, err);
  }
});

/** Agrupa episódios por temporada e grava (tabelas que o calendário já lê). Episódio sem número é ignorado: não há chave para ele. */
const persistSeasons = (db: Database, titleId: string, episodes: TvmazeEpisode[]) => {
  const bySeason = new Map<number, TvmazeEpisode[]>();
  for (const ep of episodes) {
    if (ep.number === null) continue;
    const list = bySeason.get(ep.season) ?? [];
    list.push(ep);
    bySeason.set(ep.season, list);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, eps]) => {
      const seasonRow = upsertSeason(db, titleId, { seasonNumber, name: seasonNumber === 0 ? 'Especiais' : `Temporada ${seasonNumber}` });
      const cached = replaceEpisodes(
        db,
        seasonRow.id,
        eps.map((e) => ({
          episodeNumber: e.number as number,
          name: e.name,
          overview: e.overview,
          airDate: e.airdate,
          runtime: e.runtime,
          stillPath: e.imageUrl,
        })),
      );
      return {
        seasonNumber,
        name: seasonRow.name,
        episodes: cached.map((row) => ({
          episodeNumber: row.episode_number,
          name: row.name,
          airDate: row.air_date,
          runtime: row.runtime,
          overview: row.overview,
          stillUrl: row.still_path,
        })),
      };
    });
};

tvmazeRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ error: 'id inválido' }, 400);

  try {
    const show = await tvmazeShowDetails(Number(id));
    const db = await getDb();
    const titleRow = upsertTitle(db, {
      source: 'tvmaze',
      sourceId: String(show.id),
      mediaType: 'tv',
      title: show.name,
      overview: show.overview,
      posterPath: show.imageUrl,
      releaseDate: show.premiered,
      voteAverage: show.rating,
    });
    const seasons = persistSeasons(db, titleRow.id, show.episodes);

    return c.json({
      titleId: titleRow.id,
      sourceId: String(show.id),
      title: show.name,
      overview: show.overview,
      posterUrl: show.imageUrl,
      premiered: show.premiered,
      ended: show.ended,
      status: show.status,
      voteAverage: show.rating,
      pageUrl: show.pageUrl,
      officialUrl: show.officialUrl,
      attribution: TVMAZE_ATTRIBUTION,
      seasons,
      library: getLibraryEntryByTitle(db, titleRow.id),
    });
  } catch (err) {
    return providerError(c, err);
  }
});
