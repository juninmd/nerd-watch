import { describe, expect, test } from 'bun:test';
import { isSeriesComplete, lastWatched, planMovie, planShow } from '../src/server/providers/trakt/import-plan.ts';
import type { SeasonMap } from '../src/server/providers/trakt/watched.ts';

const seasons = (entries: Record<number, number[]>): SeasonMap => new Map(Object.entries(entries).map(([s, eps]) => [Number(s), new Set(eps)]));

describe('planMovie: o que o Trakt diz que foi visto nunca rebaixa a decisão do usuário', () => {
  test('filme ausente ou "quero ver" vira assistido', () => {
    expect(planMovie(null)).toEqual({ watchStatus: 'watched' });
    expect(planMovie({ status: 'want', season: null, episode: null })).toEqual({ watchStatus: 'watched' });
  });

  test('já assistido ou abandonado fica como está (dropped é decisão explícita)', () => {
    expect(planMovie({ status: 'watched', season: null, episode: null })).toBeNull();
    expect(planMovie({ status: 'dropped', season: null, episode: null })).toBeNull();
  });
});

describe('isSeriesComplete: só "completa" com prova de todos os episódios da TMDB', () => {
  const tmdb = [{ seasonNumber: 1, episodeCount: 2 }];

  test('todos os episódios de todas as temporadas regulares vistos', () => {
    expect(isSeriesComplete(seasons({ 1: [1, 2] }), tmdb)).toBe(true);
  });

  test('falta um episódio: não está completa', () => {
    expect(isSeriesComplete(seasons({ 1: [1] }), tmdb)).toBe(false);
  });

  test('temporada da TMDB que o Trakt não tem: não está completa', () => {
    expect(isSeriesComplete(seasons({ 1: [1, 2] }), [...tmdb, { seasonNumber: 2, episodeCount: 3 }])).toBe(false);
  });

  test('especiais (temporada 0) não contam para completar a série', () => {
    expect(isSeriesComplete(seasons({ 1: [1, 2] }), [...tmdb, { seasonNumber: 0, episodeCount: 5 }])).toBe(true);
  });

  test('sem dado da TMDB não dá para afirmar: volta false (conservador)', () => {
    expect(isSeriesComplete(seasons({ 1: [1, 2] }), [])).toBe(false);
    expect(isSeriesComplete(seasons({ 1: [1, 2] }), [{ seasonNumber: 1, episodeCount: 0 }])).toBe(false);
  });
});

describe('lastWatched: ponteiro é o último episódio de temporada regular', () => {
  test('pega o maior par (temporada, episódio), não a última chave do mapa', () => {
    expect(lastWatched(seasons({ 2: [1], 1: [3, 9] }))).toEqual({ season: 2, episode: 1 });
  });

  test('ignora especiais; só especiais vistos não geram ponteiro', () => {
    expect(lastWatched(seasons({ 0: [4] }))).toBeNull();
    expect(lastWatched(seasons({ 0: [4], 1: [2] }))).toEqual({ season: 1, episode: 2 });
  });
});

describe('planShow: série parcial vira "assistindo", completa vira "assistido", sem rebaixar', () => {
  const partial = seasons({ 1: [1, 2] });

  test('parcial e nova: vira assistindo com o ponteiro no último visto', () => {
    expect(planShow(null, partial, false)).toEqual({ watchStatus: 'watching', pointer: { season: 1, episode: 2 } });
  });

  test('completa e nova: vira assistido', () => {
    expect(planShow(null, partial, true)).toEqual({ watchStatus: 'watched', pointer: { season: 1, episode: 2 } });
  });

  test('assistido no app não vira "assistindo" mesmo com dados parciais do Trakt', () => {
    expect(planShow({ status: 'watched', season: 3, episode: 1 }, partial, false)).toBeNull();
  });

  test('abandonada fica abandonada', () => {
    expect(planShow({ status: 'dropped', season: null, episode: null }, partial, true)).toBeNull();
  });

  test('assistindo com ponteiro já igual ou à frente: nada a fazer (idempotente)', () => {
    expect(planShow({ status: 'watching', season: 1, episode: 2 }, partial, false)).toBeNull();
    expect(planShow({ status: 'watching', season: 2, episode: 5 }, partial, false)).toBeNull();
  });

  test('assistindo com ponteiro atrás: avança o ponteiro, sem mexer no status', () => {
    expect(planShow({ status: 'watching', season: 1, episode: 1 }, seasons({ 1: [1, 2, 3] }), false)).toEqual({
      watchStatus: 'watching',
      pointer: { season: 1, episode: 3 },
    });
  });

  test('"quero ver" com série completa vira assistido', () => {
    expect(planShow({ status: 'want', season: null, episode: null }, partial, true)).toEqual({ watchStatus: 'watched', pointer: { season: 1, episode: 2 } });
  });

  test('só especiais vistos: não há o que importar', () => {
    expect(planShow(null, seasons({ 0: [1] }), true)).toBeNull();
  });
});
