import { describe, expect, test } from 'bun:test';
import {
  AUTO_LINK_MIN,
  type LinkCandidate,
  matchParsedName,
  normalizeName,
  SUGGEST_MIN,
} from '../src/server/media-name/match.ts';
import { parseMediaName } from '../src/server/media-name/parse.ts';

/** Biblioteca sintética: duas séries com nomes próximos e uma com temporadas, para testar o número absoluto. */
const show = (over: Partial<LinkCandidate> = {}): LinkCandidate => ({
  titleId: 'show-a',
  title: 'Show Name',
  originalTitle: null,
  year: 2010,
  episodes: [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 },
    { season: 1, episode: 3 },
  ],
  ...over,
});

const anime: LinkCandidate = {
  titleId: 'anime-x',
  title: 'Anime Title',
  originalTitle: null,
  year: null,
  episodes: [
    ...Array.from({ length: 12 }, (_, i) => ({ season: 1, episode: i + 1 })),
    ...Array.from({ length: 12 }, (_, i) => ({ season: 2, episode: i + 1 })),
  ],
};

const match = (name: string, candidates: LinkCandidate[]) => matchParsedName(parseMediaName(name), candidates);

describe('normalizeName: comparação sem acento, caixa ou pontuação', () => {
  test.each([
    ['Pokémon', 'pokemon'],
    ['AÇÃO  pura', 'acao pura'],
    ['Show.Name_Final', 'show name final'],
    ['', ''],
  ])('%j vira %j', (raw, key) => {
    expect(normalizeName(raw)).toBe(key);
  });
});

describe('matchParsedName: tabela de decisão', () => {
  test('ano e temporada no nome batem: vincula automaticamente', () => {
    expect(match('Show Name (2010) S01E02', [show()])).toEqual({
      status: 'linked',
      titleId: 'show-a',
      season: 1,
      episode: 2,
      episodeEnd: undefined,
      confidence: 1,
    });
  });

  test('sem ano no nome: nunca vincula sozinho, só sugere', () => {
    const d = match('Show Name S01E02', [show()]);
    expect(d.status).toBe('suggested');
    expect(d.status === 'unlinked' ? 0 : d.confidence).toBeLessThan(AUTO_LINK_MIN);
    expect(d.status === 'unlinked' ? 0 : d.confidence).toBeGreaterThanOrEqual(SUGGEST_MIN);
  });

  test('caixa e acento diferentes ainda casam', () => {
    const lib = show({ titleId: 'acao', title: 'Ação Pura', year: 2001 });
    expect(match('ACAO PURA (2001) S01E01', [lib])).toMatchObject({ status: 'linked', titleId: 'acao', episode: 1 });
  });

  test('ano diferente rejeita o título (remake, não o mesmo)', () => {
    expect(match('Show Name (2011) S01E02', [show()])).toEqual({ status: 'unlinked', reason: 'no_title' });
  });

  test('número de sequência faz parte do nome: "Show Name 2" não vira "Show Name"', () => {
    expect(match('Show Name 2 S01E01', [show()])).toEqual({ status: 'unlinked', reason: 'no_title' });
  });

  test('intervalo de episódios: vincula o início e guarda o fim', () => {
    const d = match('Show Name (2010) S01E01-E03', [show()]);
    expect(d).toMatchObject({ status: 'linked', season: 1, episode: 1, episodeEnd: 3 });
  });

  test('intervalo que sai do que a biblioteca conhece: não vincula', () => {
    expect(match('Show Name (2010) S01E02-E09', [show()])).toEqual({ status: 'unlinked', reason: 'no_episode' });
  });

  test('episódio que não existe na biblioteca: não vincula', () => {
    expect(match('Show Name (2010) S01E09', [show()])).toEqual({ status: 'unlinked', reason: 'no_episode' });
  });

  test('dois títulos iguais empatados: fica sem vínculo (ambíguo, nunca chuta)', () => {
    const other = show({ titleId: 'show-b' });
    expect(match('Show Name S01E02', [show(), other])).toEqual({ status: 'unlinked', reason: 'ambiguous' });
  });

  test('dois títulos iguais com ano no nome: só o do ano vale', () => {
    const remake = show({ titleId: 'show-b', year: 2020 });
    expect(match('Show Name (2020) S01E02', [show(), remake])).toMatchObject({ status: 'linked', titleId: 'show-b' });
  });

  test('número absoluto de anime cruzando temporadas: não chuta, fica sem vínculo', () => {
    expect(match('Anime Title - 14', [anime])).toEqual({ status: 'unlinked', reason: 'no_episode' });
  });

  test('número absoluto de anime dentro da 1ª temporada: mapeia para ela', () => {
    expect(match('Anime Title - 5', [anime])).toMatchObject({ status: 'suggested', season: 1, episode: 5 });
  });

  test('nome vazio nunca casa', () => {
    expect(match('S01E02', [show()])).toEqual({ status: 'unlinked', reason: 'no_name' });
  });

  test('sem biblioteca: nada a casar', () => {
    expect(match('Show Name (2010) S01E02', [])).toEqual({ status: 'unlinked', reason: 'no_title' });
  });

  test('nome original (título em outro idioma) também casa', () => {
    const lib = show({ titleId: 'orig', title: 'Titulo Local', originalTitle: 'Show Name', year: 2010 });
    expect(match('Show Name (2010) S01E03', [lib])).toMatchObject({ status: 'linked', titleId: 'orig' });
  });
});
