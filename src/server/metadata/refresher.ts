import type { Database } from 'bun:sqlite';
import type { TmdbEpisode, TmdbSeasonSummary, TmdbTitleDetails } from '../providers/tmdb.ts';
import { replaceEpisodes, updateTitleMetadata, upsertSeason } from '../repo/titles.ts';
import type { MediaType, TitleRow } from '../types.ts';

export interface RefreshDeps {
  db: Database;
  fetchDetails: (mediaType: MediaType, id: number) => Promise<TmdbTitleDetails>;
  fetchSeasonEpisodes: (tvId: number, seasonNumber: number) => Promise<TmdbEpisode[]>;
  now?: () => Date;
}

export interface RefreshResult {
  seasons: number;
  episodes: number;
  refreshedAt: string;
}

/**
 * Re-busca a TMDB e atualiza catálogo (título, temporadas, episódios). Busca tudo antes de gravar: se qualquer
 * chamada falhar, nada é escrito. Não toca em `library_entries`: status, nota, anotações e progresso são do usuário.
 */
export const refreshTitle = async (deps: RefreshDeps, title: TitleRow): Promise<RefreshResult> => {
  const tmdbId = Number(title.source_id);
  const details = await deps.fetchDetails(title.media_type, tmdbId);

  const seasons: Array<{ meta: TmdbSeasonSummary; episodes: TmdbEpisode[] }> = [];
  if (title.media_type === 'tv') {
    for (const meta of details.seasons ?? []) {
      seasons.push({ meta, episodes: await deps.fetchSeasonEpisodes(tmdbId, meta.season_number) });
    }
  }

  const refreshedAt = (deps.now ?? (() => new Date()))().toISOString();
  deps.db.transaction(() => {
    updateTitleMetadata(
      deps.db,
      title.id,
      {
        title: details.title,
        overview: details.overview,
        posterPath: details.poster_path,
        backdropPath: details.backdrop_path,
        releaseDate: details.release_date,
        voteAverage: details.vote_average,
        status: details.status,
        genres: details.genres,
        runtimeMinutes: details.runtimeMinutes,
      },
      refreshedAt,
    );
    for (const { meta, episodes } of seasons) {
      const seasonRow = upsertSeason(deps.db, title.id, {
        seasonNumber: meta.season_number,
        name: meta.name,
        overview: meta.overview,
        airDate: meta.air_date,
        posterPath: meta.poster_path,
      });
      replaceEpisodes(
        deps.db,
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
    }
  })();

  const episodeCount = seasons.reduce((total, s) => total + s.episodes.length, 0);
  return { seasons: seasons.length, episodes: episodeCount, refreshedAt };
};
