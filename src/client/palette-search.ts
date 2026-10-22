export type PaletteGroup = 'Títulos' | 'Canais' | 'Ações' | 'Catálogo';

export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  title: string;
  sub?: string;
  /** Atalho exibido à direita (ex.: "g t"). */
  keys?: string;
  run: () => void;
}

/** Minúsculas e sem acento: "novela" acha "Novéla", "sao" acha "São". */
export const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** 3 = começa com o termo, 2 = uma palavra começa com ele, 1 = contém; 0 = não bate. */
export const scoreText = (text: string, query: string): number => {
  const t = normalize(text);
  if (t.startsWith(query)) return 3;
  if (t.split(/[\s@_\-.:/]+/).some((w) => w.startsWith(query))) return 2;
  return t.includes(query) ? 1 : 0;
};

const GROUP_ORDER: PaletteGroup[] = ['Títulos', 'Canais', 'Ações', 'Catálogo'];
const LIMIT_PER_GROUP = 6;

/**
 * Filtra e ordena as entradas da paleta. Sem consulta: só ações (atalhos úteis, sem despejar a biblioteca inteira).
 * Com consulta: melhor pontuação primeiro dentro de cada grupo, grupos na ordem fixa, no máximo 6 por grupo.
 */
export const filterEntries = (entries: PaletteEntry[], rawQuery: string): PaletteEntry[] => {
  const query = normalize(rawQuery.trim());
  if (!query) return entries.filter((e) => e.group === 'Ações');

  const scored = entries
    .map((e) => ({ e, score: Math.max(scoreText(e.title, query), e.sub ? scoreText(e.sub, query) - 1 : 0) }))
    .filter((x) => x.score > 0 || x.e.group === 'Catálogo');
  return GROUP_ORDER.flatMap((g) =>
    scored
      .filter((x) => x.e.group === g)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT_PER_GROUP)
      .map((x) => x.e),
  );
};
