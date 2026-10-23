import type { Database } from 'bun:sqlite';
import type { MediaType, TitleSource } from '../types.ts';

export interface UpNextRow {
  titleId: string;
  source: TitleSource;
  sourceId: string;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string;
  runtime: number | null;
  activityAt: string;
}

/**
 * Próximo episódio não visto de cada série em andamento, pela atividade mais recente da biblioteca.
 * O marcador (`current_season`/`current_episode`) é o último episódio visto: o seguinte é o que aparece.
 * Temporada 0 (especiais) é uma trilha à parte, como em `isEpisodeWatched` no cliente.
 *
 * Plano (testado em tests/up-next-repo.test.ts): `cand` lê por `idx_library_status` e ordena um conjunto já
 * limitado por LIMIT; o join usa `idx_seasons_title` e `idx_episodes_season`. Uma consulta só, sem N+1.
 * Não usa `playback_positions`: a posição de reprodução é por vídeo de canal, sem vínculo com episódio.
 */
export const UP_NEXT_SQL = `
  WITH cand AS (
    SELECT le.title_id, le.current_season, le.current_episode, le.updated_at
    FROM library_entries le JOIN titles t ON t.id = le.title_id
    WHERE le.watch_status = 'watching' AND t.media_type = 'tv'
    ORDER BY le.updated_at DESC
    LIMIT ?
  ),
  nxt AS (
    SELECT cand.title_id, s.season_number, e.episode_number, e.name AS episode_name, e.runtime,
      ROW_NUMBER() OVER (PARTITION BY cand.title_id ORDER BY s.season_number, e.episode_number) AS rn
    FROM cand
    CROSS JOIN seasons s ON s.title_id = cand.title_id
    CROSS JOIN episodes e ON e.season_id = s.id
    WHERE CASE
      WHEN COALESCE(cand.current_season, -1) = 0
        THEN s.season_number = 0 AND e.episode_number > COALESCE(cand.current_episode, 0)
      ELSE s.season_number >= 1 AND (
        cand.current_season IS NULL
        OR s.season_number > cand.current_season
        OR (s.season_number = cand.current_season AND e.episode_number > COALESCE(cand.current_episode, 0)))
    END
  )
  SELECT cand.title_id, t.source, t.source_id, t.media_type, t.title, t.poster_path,
    nxt.season_number, nxt.episode_number, nxt.episode_name, nxt.runtime, cand.updated_at AS activity_at
  FROM cand
  JOIN titles t ON t.id = cand.title_id
  JOIN nxt ON nxt.title_id = cand.title_id AND nxt.rn = 1
  ORDER BY cand.updated_at DESC`;

interface Row {
  title_id: string;
  source: TitleSource;
  source_id: string;
  media_type: MediaType;
  title: string;
  poster_path: string | null;
  season_number: number;
  episode_number: number;
  episode_name: string;
  runtime: number | null;
  activity_at: string;
}

/** `limit` já validado pela rota (1..50); a consulta nunca devolve mais que isso. */
export const listUpNext = (db: Database, limit: number): UpNextRow[] =>
  db.query<Row, [number]>(UP_NEXT_SQL).all(limit).map((r) => ({
    titleId: r.title_id,
    source: r.source,
    sourceId: r.source_id,
    mediaType: r.media_type,
    title: r.title,
    posterPath: r.poster_path,
    seasonNumber: r.season_number,
    episodeNumber: r.episode_number,
    episodeName: r.episode_name,
    runtime: r.runtime,
    activityAt: r.activity_at,
  }));
