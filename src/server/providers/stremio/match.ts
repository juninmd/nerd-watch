import type { MetaPreview } from './protocol.ts';

/**
 * Casa um título do app com um item do catálogo do addon.
 *
 * Existe por causa dos addons que usam id próprio (`afhd:…`, `kitsu:…`): o título do app é `tt…` e o
 * addon não responde por esse esquema. Se ele publica catálogo pesquisável, dá para perguntar pelo
 * **nome** e usar o id que ele devolve. Aqui ficam as regras de confiança — errar o match mostraria
 * streams de outro filme.
 */
export interface MatchInput {
  title: string;
  /** Ano de lançamento do título no app (`2004` ou `2004-10-05`). */
  year?: string | null;
}

export interface CatalogCandidate extends MetaPreview {
  name: string;
}

/** Minúsculas, sem acento, sem pontuação: "Pokémon: A Série" e "pokemon a serie" são o mesmo nome. */
export const normalizeTitle = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const yearOf = (value: string | null | undefined): string | null => {
  const m = /\d{4}/.exec(value ?? '');
  return m ? m[0] : null;
};

/**
 * Melhor candidato do catálogo, ou `null` quando nada é confiável.
 *
 * Aceita nome idêntico, um começando pelo outro ("Bleach" ↔ "Bleach: Thousand-Year Blood War") ou —
 * só quando o ano bate — nome contido. Nome idêntico com o mesmo ano ganha de tudo. Sem isso, um
 * addon que devolve vários resultados faria o app abrir o item errado.
 */
export const bestCatalogMatch = <T extends CatalogCandidate>(items: readonly T[], input: MatchInput): T | null => {
  const wanted = normalizeTitle(input.title);
  if (!wanted) return null;
  const wantedYear = yearOf(input.year);

  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const name = normalizeTitle(item.name);
    if (!name) continue;

    const exact = name === wanted;
    const prefix = !exact && (name.startsWith(`${wanted} `) || wanted.startsWith(`${name} `));
    const contained = !exact && !prefix && (name.includes(wanted) || wanted.includes(name));
    const yearMatch = Boolean(wantedYear && yearOf(item.year) === wantedYear);

    // Sem ano, só nome idêntico é confiável: "Bleach" não pode casar "Bleach: Thousand-Year Blood War".
    if (!exact && !yearMatch) continue;
    let score = exact ? 4 : prefix ? 3 : contained ? 1 : 0;
    if (score === 0) continue;
    if (yearMatch) score += 2;

    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
};
