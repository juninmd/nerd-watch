import { describe, expect, test } from 'bun:test';
import { isEpisodeWatched } from '../src/client/episode-progress.ts';

/**
 * O progresso é um único marcador ("onde parei"): tudo que vem antes dele na mesma trilha está visto.
 * Especiais (temporada 0) são uma trilha à parte: não contam como "anteriores" de uma temporada regular.
 */
describe('isEpisodeWatched', () => {
  test('sem marcador nada está visto', () => {
    expect(isEpisodeWatched(null, 1, 1)).toBe(false);
  });

  test('o próprio marcador conta como visto', () => {
    expect(isEpisodeWatched({ season: 2, episode: 4 }, 2, 4)).toBe(true);
  });

  test('episódios anteriores na mesma temporada estão vistos, os seguintes não', () => {
    const marker = { season: 2, episode: 4 };
    expect(isEpisodeWatched(marker, 2, 1)).toBe(true);
    expect(isEpisodeWatched(marker, 2, 5)).toBe(false);
  });

  test('temporadas anteriores inteiras estão vistas, as seguintes não', () => {
    const marker = { season: 2, episode: 4 };
    expect(isEpisodeWatched(marker, 1, 99)).toBe(true);
    expect(isEpisodeWatched(marker, 3, 1)).toBe(false);
  });

  test('primeiro episódio da primeira temporada: marcado no S1E1, só ele fica visto', () => {
    const marker = { season: 1, episode: 1 };
    expect(isEpisodeWatched(marker, 1, 1)).toBe(true);
    expect(isEpisodeWatched(marker, 1, 2)).toBe(false);
  });

  test('especiais: só os especiais anteriores ao marcador especial estão vistos', () => {
    const special = { season: 0, episode: 2 };
    expect(isEpisodeWatched(special, 0, 1)).toBe(true);
    expect(isEpisodeWatched(special, 0, 3)).toBe(false);
    expect(isEpisodeWatched(special, 1, 1)).toBe(false);
  });

  test('marcar um episódio regular não marca especiais como vistos', () => {
    expect(isEpisodeWatched({ season: 1, episode: 5 }, 0, 1)).toBe(false);
  });
});
