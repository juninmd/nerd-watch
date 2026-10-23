import { cleanLines } from './clean.ts';
import { classifyAt, fold, type TagHit } from './tags.ts';
import { hasStructWord } from './structure.ts';

/** `plain` título · `attr` tag que termina o título · `ambig` palavra comum que só é tag depois do título · `struct` temporada/episódio. */
export type Kind = 'plain' | 'attr' | 'ambig' | 'year' | 'struct';

export interface Tok {
  raw: string;
  word: string;
  kind: Kind;
  hit?: TagHit;
}

export const YEAR = /^(?:19|20)\d{2}$/;
const BRACKET = /\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}/g;

const mkTok = (raw: string): Tok => ({ raw, word: fold(raw), kind: 'plain' });

export interface LineRead {
  toks: Tok[];
  bracketHits: TagHit[];
  bracketYear?: number;
  group?: string;
}

/** Lê uma linha: palavras soltas viram tokens; colchetes viram tag, ano ou grupo (e saem do título). */
export const readLine = (line: string, leading: boolean): LineRead => {
  const toks: Tok[] = [];
  const bracketHits: TagHit[] = [];
  let bracketYear: number | undefined;
  let group: string | undefined;
  let last = 0;
  const push = (text: string) => {
    for (const raw of text.split(' ')) if (raw) toks.push(mkTok(raw));
  };
  for (const m of line.matchAll(BRACKET)) {
    const at = m.index ?? 0;
    push(line.slice(last, at));
    last = at + m[0].length;
    const content = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (YEAR.test(content)) {
      bracketYear ??= Number(content);
      continue;
    }
    // Colchete com temporada/episódio ("[S01E02]") segue no fluxo: é dado, não ruído.
    if (hasStructWord(fold(content))) {
      push(content);
      continue;
    }
    const words = content.split(' ').filter(Boolean);
    const folded = words.map(fold);
    const leftover: string[] = [];
    for (let i = 0; i < words.length; ) {
      const match = classifyAt(folded, i);
      if (match) {
        bracketHits.push(match.hit);
        i += match.span;
      } else {
        leftover.push(words[i] ?? '');
        i += 1;
      }
    }
    if (leading && at === 0 && leftover.length > 0) group = leftover.join(' ');
  }
  push(line.slice(last));
  return { toks, bracketHits, bracketYear, group };
};

/** Marca cada palavra como tag (attr/ambig), ano candidato ou texto. Pares ("dual audio") ocupam duas palavras. */
export const tagKinds = (toks: Tok[]): void => {
  const words = toks.map((t) => t.word);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (!tok) continue;
    const match = classifyAt(words, i);
    if (match) {
      for (let k = 0; k < match.span; k++) {
        const t = toks[i + k];
        if (t) {
          // Ruído (AAC, DDP, Opus...) pode ser o início de um título: só vira tag depois de pelo menos uma palavra.
          t.kind = match.ambiguous || match.hit.kind === 'noise' ? 'ambig' : 'attr';
          t.hit = match.hit;
        }
      }
      i += match.span - 1;
    } else if (YEAR.test(tok.word)) {
      tok.kind = 'year';
    }
  }
};

/** Primeira linha com palavras, tokenizada e marcada. Linhas seguintes entram depois, só como tags. */
export const tokenizeCaption = (input: string) => {
  const toks: Tok[] = [];
  const hits: TagHit[] = [];
  let bracketYear: number | undefined;
  let group: string | undefined;
  /** Título só vem da primeira linha com palavras; as seguintes (sinopse, legenda) só trazem tags. */
  let titleLimit: number | undefined;
  cleanLines(input).forEach((line, idx) => {
    const read = readLine(line, idx === 0);
    toks.push(...read.toks);
    hits.push(...read.bracketHits);
    // Ano entre colchetes só vale na primeira linha: sinopse ou legenda não define o ano do vídeo.
    if (idx === 0) bracketYear ??= read.bracketYear;
    group ??= read.group;
    if (titleLimit === undefined && read.toks.length > 0) titleLimit = toks.length;
  });
  tagKinds(toks);
  return { toks, hits, bracketYear, group, titleLimit: titleLimit ?? toks.length };
};
