import { Hono, type Context } from 'hono';
import { getDb } from '../db.ts';
import { getLibraryEntryByTitle } from '../repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../repo/titles.ts';
import {
  TmdbNotConfiguredError,
  TmdbRequestError,
  tmdbImageUrl,
  tmdbSeasonEpisodes,
  tmdbTitleDetails,
  tmdbTrailerKey,
  tmdbWatchProviders,
} from '../providers/tmdb.ts';
import type { MediaType } from '../types.ts';

export const tmdbRoutes = new Hono();

const isMediaType = (v: string): v is MediaType => v === 'movie' || v === 'tv';

const handleProviderError = (c: Context, err: unknown) => {
  if (err instanceof TmdbNotConfiguredError) return c.json({ error: err.message }, 501);
  if (err instanceof TmdbRequestError) return c.json({ error: err.message }, err.status === 404 ? 404 : 502);
  throw err;
};

tmdbRoutes.get('/:mediaType/:id', async (c) => {
  const mediaType = c.req.param('mediaType');
  const id = Number(c.req.param('id'));
  if (!isMediaType(mediaType) || !Number.isInteger(id)) return c.json({ error: 'parâmetros inválidos' }, 400);

  try {
    const [details, providers, trailerKey] = await Promise.all([
      tmdbTitleDetails(mediaType, id),
      tmdbWatchProviders(mediaType, id),
      tmdbTrailerKey(mediaType, id).catch(() => null),
    ]);
    const db = await getDb();
    const titleRow = upsertTitle(db, {
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
  const id = Number(c.req.param('id'));
  const seasonNumber = Number(c.req.param('num'));
  if (mediaType !== 'tv' || !Number.isInteger(id) || !Number.isInteger(seasonNumber)) {
    return c.json({ error: 'parâmetros inválidos' }, 400);
  }

  try {
    const [details, episodes] = await Promise.all([tmdbTitleDetails('tv', id), tmdbSeasonEpisodes(id, seasonNumber)]);
    const seasonMeta = details.seasons?.find((s) => s.season_number === seasonNumber);
    const db = await getDb();
    const titleRow = upsertTitle(db, {
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
    const seasonRow = upsertSeason(db, titleRow.id, {
      seasonNumber,
      name: seasonMeta?.name ?? `Temporada ${seasonNumber}`,
      overview: seasonMeta?.overview ?? null,
      airDate: seasonMeta?.air_date ?? null,
      posterPath: seasonMeta?.poster_path ?? null,
    });
    const cached = replaceEpisodes(
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
