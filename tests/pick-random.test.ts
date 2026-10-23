import { describe, expect, test } from 'bun:test';
import { filterPickCandidates, pickRandom, type PickCandidate } from '../src/client/pick-random.ts';

/** PRNG determinístico (mulberry32): o sorteio é reproduzível nos testes. */
const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const item = (titleId: string, mediaType: 'movie' | 'tv' = 'movie', voteAverage: number | null = null): PickCandidate => ({
  titleId,
  title: { mediaType, voteAverage },
});

describe('filterPickCandidates', () => {
  const items = [item('a', 'movie', 8.1), item('b', 'tv', 6.0), item('c', 'movie', null), item('d', 'tv', 9.5)];

  test('sem filtros devolve tudo', () => {
    expect(filterPickCandidates(items, { type: 'all', minRating: null })).toHaveLength(4);
  });

  test('filtra por tipo', () => {
    expect(filterPickCandidates(items, { type: 'tv', minRating: null }).map((i) => i.titleId)).toEqual(['b', 'd']);
    expect(filterPickCandidates(items, { type: 'movie', minRating: null }).map((i) => i.titleId)).toEqual(['a', 'c']);
  });

  test('nota mínima exclui quem está abaixo e quem não tem nota (não chuta)', () => {
    expect(filterPickCandidates(items, { type: 'all', minRating: 8 }).map((i) => i.titleId)).toEqual(['a', 'd']);
  });

  test('nota mínima no limite exato entra', () => {
    expect(filterPickCandidates([item('x', 'movie', 7)], { type: 'all', minRating: 7 })).toHaveLength(1);
  });

  test('filtros combinados podem não sobrar nada', () => {
    expect(filterPickCandidates(items, { type: 'movie', minRating: 9 })).toEqual([]);
  });
});

describe('pickRandom', () => {
  test('lista vazia devolve null (estado vazio na tela, não erro)', () => {
    expect(pickRandom([], { rng: () => 0.5 })).toBeNull();
  });

  test('um único candidato é sempre escolhido, mesmo que seja o anterior', () => {
    const only = item('solo');
    expect(pickRandom([only], { rng: () => 0.9, avoidId: 'solo' })).toBe(only);
  });

  test('escolhe pelo rng injetado (determinístico)', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(pickRandom(items, { rng: () => 0 })?.titleId).toBe('a');
    expect(pickRandom(items, { rng: () => 0.5 })?.titleId).toBe('b');
    expect(pickRandom(items, { rng: () => 0.999999 })?.titleId).toBe('c');
  });

  test('rng devolvendo 1 (fora do intervalo) não estoura o índice', () => {
    const items = [item('a'), item('b')];
    expect(pickRandom(items, { rng: () => 1 })?.titleId).toBe('b');
  });

  test('com 2 ou mais candidatos, nunca repete o sorteio anterior (1000 sorteios seeded)', () => {
    const items = [item('a'), item('b'), item('c')];
    const rng = seeded(42);
    let previous = 'a';
    for (let i = 0; i < 1000; i++) {
      const next = pickRandom(items, { rng, avoidId: previous });
      expect(next?.titleId).not.toBe(previous);
      previous = next?.titleId ?? '';
    }
  });

  test('com exatamente 2 candidatos, o anterior sai e o outro sempre entra', () => {
    const items = [item('a'), item('b')];
    const rng = seeded(7);
    for (let i = 0; i < 50; i++) expect(pickRandom(items, { rng, avoidId: 'a' })?.titleId).toBe('b');
  });

  test('o anterior só é evitado se ele estiver entre os candidatos filtrados', () => {
    const items = [item('a'), item('b')];
    expect(pickRandom(items, { rng: () => 0, avoidId: 'zzz' })?.titleId).toBe('a');
  });

  test('sem avoidId o sorteio pode repetir (o anterior não é regra global)', () => {
    const items = [item('a'), item('b')];
    expect(pickRandom(items, { rng: () => 0, avoidId: null })?.titleId).toBe('a');
  });

  test('sorteio uniforme aproximado em muitas rodadas (cada título aparece)', () => {
    const items = [item('a'), item('b'), item('c'), item('d')];
    const rng = seeded(1);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 4000; i++) {
      const id = pickRandom(items, { rng })?.titleId ?? '';
      counts[id] = (counts[id] ?? 0) + 1;
    }
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(800);
  });
});
