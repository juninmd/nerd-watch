import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { refreshTitle } from '../src/server/metadata/refresher.ts';
import { openDb } from '../src/server/db.ts';
import { TmdbRequestError } from '../src/server/providers/tmdb.ts';
import { getSeasonsWithEpisodes, replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../src/server/repo/library.ts';
import type { TitleRow } from '../src/server/types.ts';
import { episode, fakeTmdb, type FakeTmdbState, movieDetails, season, tvDetails } from './helpers/tmdb-fakes.ts';

const CLOCK = new Date('2026-10-22T12:00:00.000Z');
const deps = (db: Database, state: FakeTmdbState) => ({ db, now: () => CLOCK, ...fakeTmdb(state) });

let db: Database;
let state: FakeTmdbState;
let show: TitleRow;

/** Série já guardada com 1 temporada, 2 episódios, e um acompanhamento do usuário (o que não pode ser perdido). */
const seedShow = () => {
  show = upsertTitle(db, { source: 'tmdb', sourceId: '1399', mediaType: 'tv', title: 'Série Fake', overview: 'Antiga' });
  const s1 = upsertSeason(db, show.id, { seasonNumber: 1, name: 'Temporada 1' });
  replaceEpisodes(db, s1.id, [
    { episodeNumber: 1, name: 'Episódio 1', airDate: '2020-01-01' },
    { episodeNumber: 2, name: 'Episódio 2', airDate: '2020-01-08' },
  ]);
  upsertLibraryEntry(db, show.id, { watchStatus: 'watching', rating: 8, notes: 'não perder', currentSeason: 1, currentEpisode: 2 });
};

beforeEach(() => {
  db = openDb(':memory:');
  state = { details: tvDetails(), seasons: { 1: [episode(1, '2020-01-01'), episode(2, '2020-01-08')] } };
  seedShow();
});

describe('refreshTitle: conteúdo novo entra', () => {
  test('temporada nova aparece e a antiga continua', async () => {
    state.details = tvDetails({ seasons: [season(1), season(2)] });
    state.seasons[2] = [episode(1, '2026-11-01')];

    const result = await refreshTitle(deps(db, state), show);

    expect(result.seasons).toBe(2);
    const seasons = getSeasonsWithEpisodes(db, show.id);
    expect(seasons.map((s) => s.season_number)).toEqual([1, 2]);
    expect(seasons[1]?.episodes.map((e) => e.air_date)).toEqual(['2026-11-01']);
  });

  test('data de exibição de um episódio que a TMDB mudou é atualizada', async () => {
    state.seasons[1] = [episode(1, '2020-01-01'), episode(2, '2026-10-30', 'Episódio 2')];

    await refreshTitle(deps(db, state), show);

    const [s1] = getSeasonsWithEpisodes(db, show.id);
    expect(s1?.episodes.find((e) => e.episode_number === 2)?.air_date).toBe('2026-10-30');
  });

  test('metadados do título e da temporada (nome, sinopse) também são atualizados', async () => {
    state.details = tvDetails({ overview: 'Sinopse nova', vote_average: 9.0, status: 'Ended', seasons: [{ ...season(1), name: 'Primeira' }] });

    await refreshTitle(deps(db, state), show);

    const row = db.query<TitleRow, [string]>('SELECT * FROM titles WHERE id = ?').get(show.id);
    expect(row?.overview).toBe('Sinopse nova');
    expect(row?.vote_average).toBe(9.0);
    expect(row?.metadata_status).toBe('Ended');
    expect(getSeasonsWithEpisodes(db, show.id)[0]?.name).toBe('Primeira');
  });

  test('grava metadata_refreshed_at com o relógio injetado', async () => {
    const result = await refreshTitle(deps(db, state), show);

    expect(result.refreshedAt).toBe(CLOCK.toISOString());
    const row = db.query<TitleRow, [string]>('SELECT * FROM titles WHERE id = ?').get(show.id);
    expect(row?.metadata_refreshed_at).toBe(CLOCK.toISOString());
  });
});

describe('refreshTitle: dados do usuário nunca são sobrescritos', () => {
  test('status, nota, anotações e progresso ficam exatamente como estavam', async () => {
    const before = getLibraryEntryByTitle(db, show.id);
    state.details = tvDetails({ seasons: [season(1), season(2)] });
    state.seasons[1] = [episode(1, '2019-12-25', 'Mudou o nome'), episode(2, '2026-10-30')];
    state.seasons[2] = [episode(1, '2026-11-01')];

    await refreshTitle(deps(db, state), show);

    const after = getLibraryEntryByTitle(db, show.id);
    expect(after).toEqual(before as NonNullable<typeof before>);
    expect(after).toMatchObject({ watch_status: 'watching', rating: 8, notes: 'não perder', current_season: 1, current_episode: 2 });
  });

  test('título que o usuário marcou como assistido continua assistido depois do refresh', async () => {
    upsertLibraryEntry(db, show.id, { watchStatus: 'watched' });
    await refreshTitle(deps(db, state), show);
    expect(getLibraryEntryByTitle(db, show.id)?.watch_status).toBe('watched');
  });
});

describe('refreshTitle: falha do provider não apaga nada', () => {
  test('erro 503 no detalhe: rejeita e deixa temporadas, episódios e metadados como estavam', async () => {
    const snapshotSeasons = JSON.stringify(getSeasonsWithEpisodes(db, show.id));
    const snapshotTitle = db.query('SELECT * FROM titles WHERE id = ?').get(show.id);
    state.error = new TmdbRequestError(503, 'TMDB /tv/1399 respondeu 503');

    await expect(refreshTitle(deps(db, state), show)).rejects.toThrow('503');

    expect(JSON.stringify(getSeasonsWithEpisodes(db, show.id))).toBe(snapshotSeasons);
    expect(db.query('SELECT * FROM titles WHERE id = ?').get(show.id)).toEqual(snapshotTitle as ReturnType<typeof db.query>);
  });

  test('falha na 2ª temporada: a 1ª também não é gravada (tudo ou nada)', async () => {
    state.details = tvDetails({ seasons: [season(1), season(2)] });
    state.seasons[1] = [episode(1, '2026-12-25', 'Nova data')];
    state.failSeason = { seasonNumber: 2, error: new TmdbRequestError(429, 'TMDB /tv/1399/season/2 respondeu 429') };
    const before = JSON.stringify(getSeasonsWithEpisodes(db, show.id));

    await expect(refreshTitle(deps(db, state), show)).rejects.toThrow('429');

    expect(JSON.stringify(getSeasonsWithEpisodes(db, show.id))).toBe(before);
    expect(db.query<{ metadata_refreshed_at: string | null }, [string]>('SELECT metadata_refreshed_at FROM titles WHERE id = ?').get(show.id)?.metadata_refreshed_at).toBeNull();
  });
});

describe('refreshTitle: filmes', () => {
  test('atualiza data de lançamento e nota, sem criar temporadas', async () => {
    const movie = upsertTitle(db, { source: 'tmdb', sourceId: '603', mediaType: 'movie', title: 'Filme Fake', releaseDate: '2026-12-01' });
    state.details = movieDetails({ release_date: '2026-11-20', vote_average: 7.5 });

    const result = await refreshTitle(deps(db, state), movie);

    expect(result).toMatchObject({ seasons: 0, episodes: 0 });
    const row = db.query<TitleRow, [string]>('SELECT * FROM titles WHERE id = ?').get(movie.id);
    expect(row).toMatchObject({ release_date: '2026-11-20', vote_average: 7.5 });
    expect(getSeasonsWithEpisodes(db, movie.id)).toEqual([]);
  });
});
