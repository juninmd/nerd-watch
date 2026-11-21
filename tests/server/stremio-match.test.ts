import { describe, expect, test } from 'bun:test';
import { bestCatalogMatch, normalizeTitle } from '../../src/server/providers/stremio/match.ts';

/**
 * Casamento de título do app com item de catálogo de addon. É a parte que decide se um addon de id
 * próprio (`afhd:…`) é consultado com o item certo — errar aqui mostra streams de outro filme.
 */
const item = (name: string, year: string | null = null) => ({ id: `afhd:${name}`, type: 'series', name, poster: null, year });

describe('normalizeTitle', () => {
  test('tira acento, caixa e pontuação', () => {
    expect(normalizeTitle('Pokémon: A Série')).toBe('pokemon a serie');
    expect(normalizeTitle('  Bleach  ')).toBe('bleach');
  });
});

describe('bestCatalogMatch', () => {
  test('nome idêntico ganha, com bônus de ano', () => {
    const items = [item('Bleach', '2022'), item('Bleach', '2004')];
    expect(bestCatalogMatch(items, { title: 'Bleach', year: '2004' })?.year).toBe('2004');
    expect(bestCatalogMatch(items, { title: 'Bleach' })?.year).toBe('2022');
  });

  test('nome contido só vale com o ano igual', () => {
    const tybw = [item('Bleach: Thousand-Year Blood War', '2022')];
    expect(bestCatalogMatch(tybw, { title: 'Bleach' })).toBeNull();
    expect(bestCatalogMatch(tybw, { title: 'Bleach', year: '2022' })?.name).toContain('Thousand-Year');
  });

  test('prefixo do nome casa quando o ano bate ("Bleach" ↔ "Bleach Sennen Kessen-hen")', () => {
    const items = [item('Bleach Sennen Kessen-hen', '2022')];
    expect(bestCatalogMatch(items, { title: 'Bleach' })).toBeNull();
    expect(bestCatalogMatch(items, { title: 'Bleach', year: '2022' })?.name).toBe('Bleach Sennen Kessen-hen');
  });

  test('acento e caixa não impedem o match', () => {
    expect(bestCatalogMatch([item('POKÉMON', '1997')], { title: 'pokemon', year: '1997' })?.name).toBe('POKÉMON');
  });

  test('título vazio, sem candidato ou sem relação devolvem null', () => {
    expect(bestCatalogMatch([item('Bleach')], { title: '   ' })).toBeNull();
    expect(bestCatalogMatch([], { title: 'Bleach' })).toBeNull();
    expect(bestCatalogMatch([item('Naruto')], { title: 'Bleach' })).toBeNull();
  });
});
