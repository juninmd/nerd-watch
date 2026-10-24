import type { Database } from 'bun:sqlite';
import { encodeGenres } from '../stats/catalog-fields.ts';
import type { EpisodeRow, MediaType, SeasonRow, TitleRow, TitleSource } from '../types.ts';

/** Teto de parâmetros por consulta (SQLite limita variáveis; 500 fica folgado em qualquer build). */
export const SQL_BATCH = 500;

export interface NewTitle {
  source: TitleSource;
  sourceId: string;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
}

export const upsertTitle = (db: Database, input: NewTitle): TitleRow => {
  const existing = db
    .query<TitleRow, [string, string]>('SELECT * FROM titles WHERE source = ? AND source_id = ?')
    .get(input.source, input.sourceId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO titles (id, source, source_id, media_type, title, original_title, overview, poster_path, backdrop_path, release_date, vote_average, created_at)
     VALUES ($id, $source, $sourceId, $mediaType, $title, $originalTitle, $overview, $posterPath, $backdropPath, $releaseDate, $voteAverage, $createdAt)`,
  ).run({
    $id: id,
    $source: input.source,
    $sourceId: input.sourceId,
    $mediaType: input.mediaType,
    $title: input.title,
    $originalTitle: input.originalTitle ?? null,
    $overview: input.overview ?? null,
    $posterPath: input.posterPath ?? null,
    $backdropPath: input.backdropPath ?? null,
    $releaseDate: input.releaseDate ?? null,
    $voteAverage: input.voteAverage ?? null,
    $createdAt: new Date().toISOString(),
  });
  // biome-ignore lint/style/noNonNullAssertion: acabamos de inserir esta linha
  return db.query<TitleRow, [string]>('SELECT * FROM titles WHERE id = ?').get(id)!;
};

export interface CatalogStats {
  /** `null` = o provider não trouxe o campo: a coluna guarda o valor anterior (ausência não apaga). */
  genres: string[] | null;
  runtimeMinutes: number | null;
}

/**
 * Gêneros e duração são dado de catálogo: `COALESCE` mantém o valor anterior quando o provider não trouxe o campo.
 * Nunca toca em `library_entries`.
 */
export const setCatalogStats = (db: Database, titleId: string, stats: CatalogStats): void => {
  db.query(
    `UPDATE titles SET genres = CASE WHEN $genres = '[]' AND genres IS NOT NULL THEN genres ELSE COALESCE($genres, genres) END, runtime_minutes = COALESCE($runtimeMinutes, runtime_minutes) WHERE id = $id`,
  ).run({
    $id: titleId,
    $genres: encodeGenres(stats.genres),
    $runtimeMinutes: stats.runtimeMinutes,
  });
};

export interface TitleMetadataUpdate extends CatalogStats {
  title: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  status: string | null;
}

/** Refresh do catálogo: só mexe nas colunas da TMDB; `created_at` e a lista do usuário ficam como estão. */
export const updateTitleMetadata = (db: Database, titleId: string, m: TitleMetadataUpdate, refreshedAt: string): void => {
  db.query(
    `UPDATE titles SET title = $title, overview = $overview, poster_path = $posterPath, backdrop_path = $backdropPath,
       release_date = $releaseDate, vote_average = $voteAverage, metadata_status = $status, metadata_refreshed_at = $refreshedAt,
       genres = CASE WHEN $genres = '[]' AND genres IS NOT NULL THEN genres ELSE COALESCE($genres, genres) END, runtime_minutes = COALESCE($runtimeMinutes, runtime_minutes)
     WHERE id = $id`,
  ).run({
    $id: titleId,
    $title: m.title,
    $overview: m.overview,
    $posterPath: m.posterPath,
    $backdropPath: m.backdropPath,
    $releaseDate: m.releaseDate,
    $voteAverage: m.voteAverage,
    $status: m.status,
    $refreshedAt: refreshedAt,
    $genres: encodeGenres(m.genres),
    $runtimeMinutes: m.runtimeMinutes,
  });
};

/** Títulos TMDB pelos ids (em lotes: uma consulta por lote, não uma por id). */
export const findTmdbTitles = (db: Database, tmdbIds: string[]): TitleRow[] => {
  const rows: TitleRow[] = [];
  for (let i = 0; i < tmdbIds.length; i += SQL_BATCH) {
    const chunk = tmdbIds.slice(i, i + SQL_BATCH);
    rows.push(
      ...db
        .query<TitleRow, string[]>(`SELECT * FROM titles WHERE source = 'tmdb' AND source_id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk),
    );
  }
  return rows;
};

export const getTitle = (db: Database, id: string): TitleRow | null =>
  db.query<TitleRow, [string]>('SELECT * FROM titles WHERE id = ?').get(id);

export const upsertSeason = (
  db: Database,
  titleId: string,
  season: { seasonNumber: number; name: string; overview?: string | null; airDate?: string | null; posterPath?: string | null },
): SeasonRow => {
  const existing = db
    .query<SeasonRow, [string, number]>('SELECT * FROM seasons WHERE title_id = ? AND season_number = ?')
    .get(titleId, season.seasonNumber);
  if (existing) {
    // Nome, sinopse e data de temporada mudam na TMDB; a linha é só catálogo (nada do usuário fica aqui).
    const next = {
      name: season.name,
      overview: season.overview ?? null,
      air_date: season.airDate ?? null,
      poster_path: season.posterPath ?? null,
    };
    db.query('UPDATE seasons SET name = $name, overview = $overview, air_date = $air_date, poster_path = $poster_path WHERE id = $id').run({
      $id: existing.id,
      $name: next.name,
      $overview: next.overview,
      $air_date: next.air_date,
      $poster_path: next.poster_path,
    });
    return { ...existing, ...next };
  }

  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO seasons (id, title_id, season_number, name, overview, air_date, poster_path)
     VALUES ($id, $titleId, $seasonNumber, $name, $overview, $airDate, $posterPath)`,
  ).run({
    $id: id,
    $titleId: titleId,
    $seasonNumber: season.seasonNumber,
    $name: season.name,
    $overview: season.overview ?? null,
    $airDate: season.airDate ?? null,
    $posterPath: season.posterPath ?? null,
  });
  // biome-ignore lint/style/noNonNullAssertion: acabamos de inserir esta linha
  return db.query<SeasonRow, [string]>('SELECT * FROM seasons WHERE id = ?').get(id)!;
};

export const replaceEpisodes = (
  db: Database,
  seasonId: string,
  episodes: Array<{ episodeNumber: number; name: string; overview?: string | null; airDate?: string | null; runtime?: number | null; stillPath?: string | null }>,
): EpisodeRow[] => {
  const insert = db.query(
    `INSERT INTO episodes (id, season_id, episode_number, name, overview, air_date, runtime, still_path)
     VALUES ($id, $seasonId, $episodeNumber, $name, $overview, $airDate, $runtime, $stillPath)
     ON CONFLICT (season_id, episode_number) DO UPDATE SET
       name = excluded.name, overview = excluded.overview, air_date = excluded.air_date,
       runtime = excluded.runtime, still_path = excluded.still_path`,
  );
  const tx = db.transaction((rows: typeof episodes) => {
    for (const ep of rows) {
      insert.run({
        $id: crypto.randomUUID(),
        $seasonId: seasonId,
        $episodeNumber: ep.episodeNumber,
        $name: ep.name,
        $overview: ep.overview ?? null,
        $airDate: ep.airDate ?? null,
        $runtime: ep.runtime ?? null,
        $stillPath: ep.stillPath ?? null,
      });
    }
  });
  tx(episodes);
  return db.query<EpisodeRow, [string]>('SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number').all(seasonId);
};

export const getSeasonsWithEpisodes = (db: Database, titleId: string): Array<SeasonRow & { episodes: EpisodeRow[] }> => {
  const seasons = db
    .query<SeasonRow, [string]>('SELECT * FROM seasons WHERE title_id = ? ORDER BY season_number')
    .all(titleId);
  if (seasons.length === 0) return [];

  const placeholders = seasons.map(() => '?').join(', ');
  const episodes = db
    .query<EpisodeRow, string[]>(`SELECT * FROM episodes WHERE season_id IN (${placeholders}) ORDER BY episode_number`)
    .all(...seasons.map((s) => s.id));
  const episodesBySeason = new Map<string, EpisodeRow[]>();
  for (const ep of episodes) {
    const list = episodesBySeason.get(ep.season_id);
    if (list) list.push(ep);
    else episodesBySeason.set(ep.season_id, [ep]);
  }
  return seasons.map((season) => ({ ...season, episodes: episodesBySeason.get(season.id) ?? [] }));
};
