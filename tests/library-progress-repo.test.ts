import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { InvalidProgressError, markProgressThrough, ProgressNotFoundError } from '../src/server/repo/library-progress.ts';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
});

/** Série com temporadas cacheadas: { número da temporada: quantidade de episódios }. */
const seedSeries = (seasons: Record<number, number>) => {
  const title = upsertTitle(db, { source: 'tmdb', sourceId: '500', mediaType: 'tv', title: 'Série' });
  for (const [num, count] of Object.entries(seasons)) {
    const season = upsertSeason(db, title.id, { seasonNumber: Number(num), name: `T${num}` });
    replaceEpisodes(
      db,
      season.id,
      Array.from({ length: count }, (_, i) => ({ episodeNumber: i + 1, name: `Ep ${i + 1}` })),
    );
  }
  return title;
};

const seedMovie = () => upsertTitle(db, { source: 'tmdb', sourceId: '501', mediaType: 'movie', title: 'Filme' });

const countEntries = () => db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM library_entries').get()?.n ?? 0;

describe('markProgressThrough', () => {
  test('sem entrada na biblioteca: cria como "assistindo" e devolve o estado anterior nulo', () => {
    const s = seedSeries({ 1: 3 });
    const result = markProgressThrough(db, s.id, 1, 2);
    expect(result.changed).toBe(true);
    expect(result.previous).toBeNull();
    expect(result.item.watch_status).toBe('watching');
    expect(result.item.current_season).toBe(1);
    expect(result.item.current_episode).toBe(2);
  });

  test('guarda o estado anterior lido dentro da transação, para o desfazer restaurar exatamente', () => {
    const s = seedSeries({ 1: 3, 2: 2 });
    upsertLibraryEntry(db, s.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    const result = markProgressThrough(db, s.id, 2, 2);
    expect(result.previous).toEqual({ watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    expect(result.item.current_season).toBe(2);
    expect(result.item.current_episode).toBe(2);
  });

  test('não muda o status de quem já está em outro estado (assistido continua assistido)', () => {
    const s = seedSeries({ 1: 3 });
    upsertLibraryEntry(db, s.id, { watchStatus: 'watched', currentSeason: 1, currentEpisode: 3 });
    const result = markProgressThrough(db, s.id, 1, 1);
    expect(result.item.watch_status).toBe('watched');
  });

  test('repetir o mesmo marcador não grava nada: changed false e updated_at intacto', () => {
    const s = seedSeries({ 1: 3 });
    markProgressThrough(db, s.id, 1, 2);
    const before = getLibraryEntryByTitle(db, s.id)?.updated_at;
    const again = markProgressThrough(db, s.id, 1, 2);
    expect(again.changed).toBe(false);
    expect(again.item.updated_at).toBe(before ?? '');
    expect(again.previous).toEqual({ watchStatus: 'watching', currentSeason: 1, currentEpisode: 2 });
  });

  test('primeiro episódio da primeira temporada e último da última são marcáveis', () => {
    const s = seedSeries({ 1: 3, 2: 2 });
    expect(markProgressThrough(db, s.id, 1, 1).item.current_episode).toBe(1);
    expect(markProgressThrough(db, s.id, 2, 2).item.current_season).toBe(2);
  });

  test('especiais (temporada 0) são marcáveis como qualquer temporada', () => {
    const s = seedSeries({ 0: 2, 1: 2 });
    const result = markProgressThrough(db, s.id, 0, 2);
    expect(result.item.current_season).toBe(0);
    expect(result.item.current_episode).toBe(2);
  });

  test('título desconhecido: ProgressNotFoundError e nada gravado', () => {
    expect(() => markProgressThrough(db, 'id-que-nao-existe', 1, 1)).toThrow(ProgressNotFoundError);
    expect(countEntries()).toBe(0);
  });

  test('filme não tem temporadas: InvalidProgressError', () => {
    const movie = seedMovie();
    expect(() => markProgressThrough(db, movie.id, 1, 1)).toThrow(InvalidProgressError);
    expect(countEntries()).toBe(0);
  });

  test('episódio que não existe na temporada cacheada: ProgressNotFoundError e nada gravado', () => {
    const s = seedSeries({ 1: 3 });
    expect(() => markProgressThrough(db, s.id, 1, 4)).toThrow(ProgressNotFoundError);
    expect(countEntries()).toBe(0);
  });

  test('temporada que nunca foi carregada: ProgressNotFoundError (não dá para validar)', () => {
    const s = seedSeries({ 1: 3 });
    expect(() => markProgressThrough(db, s.id, 9, 1)).toThrow(ProgressNotFoundError);
  });

  test('falha no meio não deixa progresso parcial: o estado anterior é preservado', () => {
    const s = seedSeries({ 1: 3 });
    upsertLibraryEntry(db, s.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    expect(() => markProgressThrough(db, s.id, 1, 99)).toThrow(ProgressNotFoundError);
    expect(getLibraryEntryByTitle(db, s.id)?.current_episode).toBe(1);
  });

  test('duplo clique (duas gravações seguidas): só a primeira muda o estado, a segunda não sobrescreve o anterior', () => {
    const s = seedSeries({ 1: 3 });
    upsertLibraryEntry(db, s.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    const first = markProgressThrough(db, s.id, 1, 3);
    const second = markProgressThrough(db, s.id, 1, 3);
    expect(first.changed).toBe(true);
    expect(first.previous?.currentEpisode).toBe(1);
    expect(second.changed).toBe(false);
  });
});
