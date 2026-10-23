import type { Tok } from './tokens.ts';

/**
 * Temporada, episódio e fim do título. Opera sobre o texto folded (sem acento, minúscula) das palavras já
 * tokenizadas, unido por espaços. Patterns sem `g`: `exec` sempre pega a primeira ocorrência.
 */
export interface StructMatch {
  tok: number;
  season?: number;
  episode?: number;
  episodeEnd?: number;
}

const SEPARATOR_WORD = /^[-|:,/~]+$/;
/** Temporada+episódio juntos: S01E02, T02E03, "Temporada 2 Episódio 3", S01E01-E03, S01E01E02. */
const SE =
  /(?<![\w'])(?:s|t|temp|temporada|season)[\s.-]*0*(\d{1,2})[\s.-]*(?:e|ep|episodio|episode|cap|capitulo)[\s.-]*0*(\d{1,3})(?:(?:-|e)[\s.-]*e?0*(\d{1,3}))?\b/;
/** "1x02" e "1x01-03". */
const NXM = /\b(\d{1,2})x(\d{1,3})(?:-(\d{1,3}))?\b/;
const SEASON_ONLY = /(?<![\w'])(?:temporada|temp|season|s)[\s.-]*0*(\d{1,2})\b/;
const EPISODE_ONLY = /\b(?:episodio|episode|ep|cap|capitulo)[\s.-]*0*(\d{1,3})\b/;
/** "E05" sozinho: só com título antes dele (ou série informada pelo chamador). */
const BARE_E = /\be[\s.-]*0*(\d{1,3})\b/;
const STRUCT_PATTERNS = [SE, NXM, SEASON_ONLY, EPISODE_ONLY];

/** Colchete com temporada/episódio dentro é dado, não ruído. */
export const hasStructWord = (folded: string): boolean => STRUCT_PATTERNS.some((re) => re.test(folded));

/** Índice da palavra que contém a posição `pos` do texto unido por espaços (`starts` é crescente). */
const tokAt = (starts: number[], pos: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export const titleBefore = (toks: Tok[], idx: number): boolean =>
  toks.slice(0, idx).some((t) => t.kind === 'plain' || t.kind === 'ambig' || t.kind === 'year');

/**
 * Temporada e episódio. Ordem: SxxExx / NxM (par completo) primeiro; senão as formas soltas. "E05" solto só vale
 * com título antes ou série informada. Marca as palavras usadas como `struct`.
 */
export const findStruct = (
  toks: Tok[],
  joined: string,
  starts: number[],
  allowBare: (tok: number) => boolean,
): StructMatch[] => {
  const mark = (tok: number, end: number) => {
    for (let k = tok; k <= end; k++) {
      const t = toks[k];
      if (t) t.kind = 'struct';
    }
  };
  for (const re of [SE, NXM]) {
    const m = re.exec(joined);
    if (!m || m.index === undefined) continue;
    const tok = tokAt(starts, m.index);
    mark(tok, tokAt(starts, m.index + m[0].length - 1));
    return [{ tok, season: Number(m[1]), episode: Number(m[2]), episodeEnd: m[3] ? Number(m[3]) : undefined }];
  }
  const found: StructMatch[] = [];
  const season = SEASON_ONLY.exec(joined);
  if (season?.index !== undefined) {
    const tok = tokAt(starts, season.index);
    mark(tok, tok);
    found.push({ tok, season: Number(season[1]) });
  }
  const episode = EPISODE_ONLY.exec(joined);
  const bare = episode ? null : BARE_E.exec(joined);
  const at = (episode ?? bare)?.index;
  if (at !== undefined) {
    const tok = tokAt(starts, at);
    if (episode || allowBare(tok)) {
      mark(tok, tok);
      found.push({ tok, episode: Number((episode ?? bare)?.[1]) });
    }
  }
  return found;
};

/** "Título - 12 [1080p]": traço, número de 1-3 dígitos, e só então tag, outro traço ou fim. Exige título antes. */
export const findAnimeEpisode = (toks: Tok[]): StructMatch | null => {
  for (let i = 1; i < toks.length; i++) {
    const dash = toks[i];
    const num = toks[i + 1];
    const after = toks[i + 2];
    if (!dash || !num || dash.word !== '-' || !/^\d{1,3}(?:v\d)?$/.test(num.word)) continue;
    if (!(after === undefined || after.word === '-' || after.kind === 'attr' || after.kind === 'ambig')) continue;
    if (!titleBefore(toks, i)) continue;
    dash.kind = 'struct';
    num.kind = 'struct';
    return { tok: i, episode: Number.parseInt(num.word, 10) };
  }
  return null;
};

/**
 * Fim do título: primeira tag, marcador ou ano que vem depois de pelo menos uma palavra de título. `limit` é o fim
 * da primeira linha com palavras; nada depois dele conta como título nem como lookahead de tag.
 */
export const findBoundary = (
  toks: Tok[],
  limit: number,
  hasBracketYear: boolean,
): { boundary: number; yearTok: number } => {
  const tagNext = (j: number) => j >= limit || ['attr', 'struct', 'ambig'].includes(toks[j]?.kind ?? '');
  let titles = 0;
  for (let i = 0; i < limit; i++) {
    const t = toks[i];
    if (!t) continue;
    if (t.kind === 'struct') return { boundary: i, yearTok: -1 };
    if (t.kind === 'attr') {
      if (titles > 0) return { boundary: i, yearTok: -1 };
      continue;
    }
    if (t.kind === 'ambig' && titles > 0 && tagNext(i + 1)) return { boundary: i, yearTok: -1 };
    if (t.kind === 'year' && titles > 0 && !hasBracketYear && tagNext(i + 1)) return { boundary: i, yearTok: i };
    titles++;
  }
  return { boundary: limit, yearTok: -1 };
};

export const trimSeparators = (toks: Tok[]): Tok[] => {
  let from = 0;
  let to = toks.length;
  while (from < to && SEPARATOR_WORD.test(toks[from]?.raw ?? '')) from++;
  while (to > from && SEPARATOR_WORD.test(toks[to - 1]?.raw ?? '')) to--;
  return toks.slice(from, to);
};
