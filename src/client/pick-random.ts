/** Sorteio "o que assistir hoje": lógica pura (sem DOM e sem rede), com o gerador de números injetável para os testes. */

export interface PickCandidate {
  titleId: string;
  title: { mediaType: 'movie' | 'tv'; voteAverage: number | null };
}

export type PickType = 'all' | 'movie' | 'tv';

export interface PickFilters {
  type: PickType;
  /** Nota mínima da TMDB/catálogo (`voteAverage`). Título sem nota fica de fora quando o filtro está ativo. */
  minRating: number | null;
}

export const filterPickCandidates = <T extends PickCandidate>(items: T[], filters: PickFilters): T[] =>
  items.filter(
    (it) =>
      (filters.type === 'all' || it.title.mediaType === filters.type) &&
      (filters.minRating === null || (it.title.voteAverage !== null && it.title.voteAverage >= filters.minRating)),
  );

interface PickOptions {
  /** Gerador em [0, 1). Padrão: Math.random. */
  rng?: () => number;
  /** Último sorteado: com 2 ou mais candidatos ele não sai de novo logo em seguida. */
  avoidId?: string | null;
}

export const pickRandom = <T extends PickCandidate>(items: T[], opts: PickOptions = {}): T | null => {
  if (items.length === 0) return null;
  const rng = opts.rng ?? Math.random;
  const others = opts.avoidId && items.length >= 2 ? items.filter((it) => it.titleId !== opts.avoidId) : items;
  const pool = others.length > 0 ? others : items;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[Math.max(0, index)] ?? null;
};
