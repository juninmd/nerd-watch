import { Hono, type Context } from 'hono';
import { getDb } from '../db/database.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { replaceEpisodes, setCatalogStats, upsertSeason, upsertTitle } from '../repo/titles.ts';
import {
  TmdbNotConfiguredError,
  TmdbRequestError,
  tmdbImageUrl,
  tmdbSeasonEpisodes,
  tmdbTitleDetails,
  tmdbTrailerKey,
  tmdbWatchProviders,
} from '../providers/tmdb.ts';
import { compareSources, pickTvmazeMatch } from '../compare/source-compare.ts';
import { tvmazeSearchShows } from '../providers/tvmaze.ts';
import { CatalogRequestError } from '../lib/catalog-text.ts';
import type { MediaType } from '../types.ts';

export const tmdbRoutes = new Hono();

const isMediaType = (v: string): v is MediaType => v === 'movie' || v === 'tv';
const POSITIVE_ID_RE = /^[1-9]\d{0,9}$/;
const SEASON_NUM_RE = /^\d{1,4}$/;

const handleProviderError = (c: Context, err: unknown) => {
  if (err instanceof TmdbNotConfiguredError) return c.json({ error: err.message }, 501);
  if (err instanceof TmdbRequestError) return c.json({ error: err.message }, err.status === 404 ? 404 : 502);
  throw err;
};

/** Compara a série com a TVmaze (status, estreia, nota). Sem correspondência segura, devolve `match: null` em vez de chutar. */
tmdbRoutes.get('/tv/:id/compare', async (c) => {
  const rawId = c.req.param('id');
  if (!POSITIVE_ID_RE.test(rawId)) return c.json({ error: 'parâmetros inválidos' }, 400);
  const id = Number(rawId);
  try {
    const d = await tmdbTitleDetails('tv', id);
    const year = d.release_date?.slice(0, 4) ?? null;
    const hits = await tvmazeSearchShows(d.title).catch((err) => {
      if (err instanceof CatalogRequestError) return [];
      throw err;
    });
    const match = pickTvmazeMatch(d.title, year, hits);
    if (!match) return c.json({ match: null, rows: [] });
    const rows = compareSources({ status: d.status, year, rating: d.vote_average || null }, { status: match.status, year: match.year, rating: match.rating });
    return c.json({ match: { id: String(match.id), name: match.name }, rows });
  } catch (err) {
    return handleProviderError(c, err);
  }
});

tmdbRoutes.get('/:mediaType/:id', async (c) => {
  const mediaType = c.req.param('mediaType');
  const rawId = c.req.param('id');
  if (!isMediaType(mediaType) || !POSITIVE_ID_RE.test(rawId)) return c.json({ error: 'parâmetros inválidos' }, 400);
  const id = Number(rawId);

  try {
    const [details, providers, trailerKey] = await Promise.all([
      tmdbTitleDetails(mediaType, id),
      tmdbWatchProviders(mediaType, id),
      tmdbTrailerKey(mediaType, id).catch(() => null),
    ]);
    const db = await getDb();
    const titleRow = db.transaction(() => {
      const row = upsertTitle(db, {
        source: 'tmdb',
        sourceId: String(id),
        mediaType,
        title: details.title,
        overview: details.overview,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        releaseDate: details.release_date,
        voteAverage: details.vote_average,
      });
      // Gêneros e duração são catálogo: preenchidos a cada detalhe aberto, sem tocar na lista do usuário.
      setCatalogStats(db, row.id, { genres: details.genres, runtimeMinutes: details.runtimeMinutes });
      return row;
    })();
    const libraryEntry = getLibraryEntryByTitle(db, titleRow.id);

    return c.json({
      titleId: titleRow.id,
      title: details.title,
      overview: details.overview,
      posterUrl: tmdbImageUrl(details.poster_path, 'w500'),
      backdropUrl: tmdbImageUrl(details.backdrop_path, 'w780'),
      releaseDate: details.release_date,
      voteAverage: details.vote_average,
      status: details.status,
      trailerKey,
      seasons: (details.seasons ?? []).map((s) => ({
        seasonNumber: s.season_number,
        name: s.name,
        overview: s.overview,
        airDate: s.air_date,
        posterUrl: tmdbImageUrl(s.poster_path, 'w342'),
        episodeCount: s.episode_count,
      })),
      watchProviders: {
        link: providers.link,
        flatrate: providers.flatrate.map((p) => ({ name: p.provider_name, logoUrl: tmdbImageUrl(p.logo_path, 'w342') })),
        rent: providers.rent.map((p) => ({ name: p.provider_name, logoUrl: tmdbImageUrl(p.logo_path, 'w342') })),
        buy: providers.buy.map((p) => ({ name: p.provider_name, logoUrl: tmdbImageUrl(p.logo_path, 'w342') })),
      },
      library: libraryEntry,
    });
  } catch (err) {
    return handleProviderError(c, err);
  }
});

tmdbRoutes.get('/:mediaType/:id/season/:num', async (c) => {
  const mediaType = c.req.param('mediaType');
  const rawId = c.req.param('id');
  const rawSeason = c.req.param('num');
  if (mediaType !== 'tv' || !POSITIVE_ID_RE.test(rawId) || !SEASON_NUM_RE.test(rawSeason)) {
    return c.json({ error: 'parâmetros inválidos' }, 400);
  }
  const id = Number(rawId);
  const seasonNumber = Number(rawSeason);

  try {
    const [details, episodes] = await Promise.all([tmdbTitleDetails('tv', id), tmdbSeasonEpisodes(id, seasonNumber)]);
    const seasonMeta = details.seasons?.find((s) => s.season_number === seasonNumber);
    const db = await getDb();
    const { titleRow, cached } = db.transaction(() => {
      const row = upsertTitle(db, {
        source: 'tmdb',
        sourceId: String(id),
        mediaType: 'tv',
        title: details.title,
        overview: details.overview,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        releaseDate: details.release_date,
        voteAverage: details.vote_average,
      });
      const seasonRow = upsertSeason(db, row.id, {
        seasonNumber,
        name: seasonMeta?.name ?? `Temporada ${seasonNumber}`,
        overview: seasonMeta?.overview ?? null,
        airDate: seasonMeta?.air_date ?? null,
        posterPath: seasonMeta?.poster_path ?? null,
      });
      const eps = replaceEpisodes(
        db,
        seasonRow.id,
        episodes.map((e) => ({
          episodeNumber: e.episode_number,
          name: e.name,
          overview: e.overview,
          airDate: e.air_date,
          runtime: e.runtime,
          stillPath: e.still_path,
        })),
      );
      return { titleRow: row, cached: eps };
    })();

    return c.json({
      titleId: titleRow.id,
      seasonNumber,
      episodes: cached.map((e) => ({
        episodeNumber: e.episode_number,
        name: e.name,
        overview: e.overview,
        airDate: e.air_date,
        runtime: e.runtime,
        stillUrl: tmdbImageUrl(e.still_path, 'w342'),
      })),
    });
  } catch (err) {
    return handleProviderError(c, err);
  }
});
