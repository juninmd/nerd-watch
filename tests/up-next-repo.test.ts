import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { listUpNext, UP_NEXT_SQL } from '../src/server/repo/up-next.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

/** Série com temporadas cacheadas: `seasons` = { número: quantidade de episódios }. */
const seedSeries = (sourceId: string, seasons: Record<number, number>, mediaType: 'tv' | 'movie' = 'tv') => {
  const title = upsertTitle(db, { source: 'tmdb', sourceId, mediaType, title: `Série ${sourceId}` });
  for (const [num, count] of Object.entries(seasons)) {
    const season = upsertSeason(db, title.id, { seasonNumber: Number(num), name: `T${num}` });
    replaceEpisodes(
      db,
      season.id,
      Array.from({ length: count }, (_, i) => ({ episodeNumber: i + 1, name: `Ep ${i + 1}`, runtime: 40 })),
    );
  }
  return title;
};

const watching = (titleId: string, season: number | null, episode: number | null) =>
  upsertLibraryEntry(db, titleId, { watchStatus: 'watching', currentSeason: season, currentEpisode: episode });

const setActivity = (titleId: string, iso: string) => {
  db.query('UPDATE library_entries SET updated_at = ? WHERE title_id = ?').run(iso, titleId);
};

describe('listUpNext: próximo episódio após o marcador', () => {
  test('mostra o episódio seguinte dentro da mesma temporada', () => {
    const s = seedSeries('1', { 1: 3, 2: 2 });
    watching(s.id, 1, 2);
    const [row] = listUpNext(db, 10);
    expect(row).toMatchObject({ titleId: s.id, seasonNumber: 1, episodeNumber: 3, episodeName: 'Ep 3', runtime: 40 });
  });

  test('ao fim de uma temporada, avança para o primeiro episódio da próxima', () => {
    const s = seedSeries('2', { 1: 3, 2: 2 });
    watching(s.id, 1, 3);
    const [row] = listUpNext(db, 10);
    expect(row).toMatchObject({ seasonNumber: 2, episodeNumber: 1 });
  });

  test('série sem episódio seguinte cacheado não aparece (último episódio conhecido)', () => {
    const s = seedSeries('3', { 1: 3 });
    watching(s.id, 1, 3);
    expect(listUpNext(db, 10)).toEqual([]);
  });

  test('série em andamento sem marcador começa pelo S1E1', () => {
    const s = seedSeries('4', { 1: 2 });
    watching(s.id, null, null);
    const [row] = listUpNext(db, 10);
    expect(row).toMatchObject({ seasonNumber: 1, episodeNumber: 1 });
  });

  test('especiais (temporada 0) são uma trilha à parte: não entram na trilha regular', () => {
    const s = seedSeries('5', { 0: 2, 1: 2 });
    watching(s.id, null, null);
    const [row] = listUpNext(db, 10);
    expect(row).toMatchObject({ seasonNumber: 1, episodeNumber: 1 });

    watching(s.id, 0, 1);
    const [special] = listUpNext(db, 10);
    expect(special).toMatchObject({ seasonNumber: 0, episodeNumber: 2 });

    watching(s.id, 0, 2);
    expect(listUpNext(db, 10)).toEqual([]);
  });

  test('ignora filmes, séries que não estão em andamento e marcadores fora da lista', () => {
    const movie = seedSeries('6', {}, 'movie');
    upsertLibraryEntry(db, movie.id, { watchStatus: 'watching' });
    const want = seedSeries('7', { 1: 3 });
    upsertLibraryEntry(db, want.id, { watchStatus: 'want', currentSeason: 1, currentEpisode: 1 });
    expect(listUpNext(db, 10)).toEqual([]);
  });
});

describe('listUpNext: ordem por atividade e limite', () => {
  test('ordena pela atividade mais recente da biblioteca', () => {
    const older = seedSeries('10', { 1: 3 });
    const newer = seedSeries('11', { 1: 3 });
    watching(older.id, 1, 1);
    watching(newer.id, 1, 1);
    setActivity(older.id, '2026-01-01T10:00:00.000Z');
    setActivity(newer.id, '2026-06-01T10:00:00.000Z');
    expect(listUpNext(db, 10).map((r) => r.titleId)).toEqual([newer.id, older.id]);
  });

  test('o limite corta a lista depois de ordenar', () => {
    const a = seedSeries('20', { 1: 3 });
    const b = seedSeries('21', { 1: 3 });
    const c = seedSeries('22', { 1: 3 });
    for (const [t, day] of [[a, 1], [b, 2], [c, 3]] as const) {
      watching(t.id, 1, 1);
      setActivity(t.id, `2026-01-0${day}T00:00:00.000Z`);
    }
    expect(listUpNext(db, 2).map((r) => r.titleId)).toEqual([c.id, b.id]);
  });

  test('a consulta usa os índices de temporada e episódio (sem varredura da tabela de episódios)', () => {
    const s = seedSeries('30', { 1: 3 });
    watching(s.id, 1, 1);
    const plan = db
      .query<{ detail: string }, [number]>(`EXPLAIN QUERY PLAN ${UP_NEXT_SQL}`)
      .all(50)
      .map((r) => r.detail)
      .join('\n');
    expect(plan).toContain('idx_seasons_title');
    expect(plan).toContain('idx_episodes_season');
    expect(plan).not.toMatch(/SCAN (episodes|seasons)\b/);
  });
});
