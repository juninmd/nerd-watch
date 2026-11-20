import { describe, expect, test } from 'bun:test';
import type { AddonVideo } from '../../src/client/addons/episode-model.ts';
import { filterEpisodes, groupEpisodes, seasonLabel } from '../../src/client/addons/episode-model.ts';

const video = (season: number | null, episode: number | null, title: string): AddonVideo => ({
  id: `tt1:${season ?? 0}:${episode ?? 0}`,
  title,
  season,
  episode,
});

describe('agrupamento de episódios do addon', () => {
  test('separa por temporada em ordem crescente e numera os episódios', () => {
    const groups = groupEpisodes([video(2, 3, 'C'), video(1, 2, 'B'), video(2, 1, 'A'), video(1, 1, 'Z')]);
    expect(groups.map((g) => g.season)).toEqual([1, 2]);
    expect(groups[0]?.label).toBe('Temporada 1');
    expect(groups[0]?.episodes.map((e) => e.title)).toEqual(['Z', 'B']);
    expect(groups[1]?.episodes.map((e) => e.title)).toEqual(['A', 'C']);
  });

  test('vídeo sem temporada vai para o fim como "Extras"', () => {
    const groups = groupEpisodes([video(null, null, 'Bastidores'), video(1, 1, 'Piloto')]);
    expect(groups.map((g) => g.label)).toEqual(['Temporada 1', 'Extras']);
    expect(groups[1]?.season).toBeNull();
  });

  test('temporada vazia não aparece e lista vazia devolve nada', () => {
    expect(groupEpisodes([])).toEqual([]);
    expect(seasonLabel(null)).toBe('Extras');
    expect(seasonLabel(7)).toBe('Temporada 7');
  });

  test('temporada 0 é "Especiais" (convenção do IMDb para bônus)', () => {
    expect(seasonLabel(0)).toBe('Especiais');
    expect(groupEpisodes([video(0, 1, 'Bônus'), video(1, 1, 'Piloto')]).map((g) => g.label)).toEqual(['Especiais', 'Temporada 1']);
  });
});

describe('filtro de episódios', () => {
  const episodes = [video(1, 1, 'Piloto'), video(1, 2, 'O segundo'), video(1, 10, 'Finale')];

  test('busca por título ignora caixa e casa trecho', () => {
    expect(filterEpisodes(episodes, 'SEGUNDO').map((e) => e.title)).toEqual(['O segundo']);
    expect(filterEpisodes(episodes, 'piloto').map((e) => e.title)).toEqual(['Piloto']);
  });

  test('busca por número do episódio aceita "2" e "02"', () => {
    expect(filterEpisodes(episodes, '2').map((e) => e.title)).toEqual(['O segundo']);
    expect(filterEpisodes(episodes, '02').map((e) => e.title)).toEqual(['O segundo']);
    expect(filterEpisodes(episodes, '10').map((e) => e.title)).toEqual(['Finale']);
  });

  test('sem termo devolve a lista inteira (cópia) e termo sem resultado devolve vazio', () => {
    const all = filterEpisodes(episodes, '   ');
    expect(all).toHaveLength(3);
    expect(all).not.toBe(episodes);
    expect(filterEpisodes(episodes, 'nada a ver')).toEqual([]);
  });
});
