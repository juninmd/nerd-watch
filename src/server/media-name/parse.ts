import type { AudioMode, Codec, Resolution, Source, TagHit } from './tags.ts';
import { findAnimeEpisode, findBoundary, findStruct, titleBefore, trimSeparators } from './structure.ts';
import { tokenizeCaption } from './tokens.ts';

/**
 * Campos de um nome de arquivo ou legenda. Ausente = não achado no texto (nunca um palpite).
 * `title` é sempre string: vazia quando o texto não traz título nenhum.
 */
export interface ParsedMediaName {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution?: Resolution;
  source?: Source;
  codec?: Codec;
  audio?: AudioMode;
  /** Códigos de idioma explícitos no nome ("PT-BR", "Inglês"). Não inferidos de "Dublado". */
  languageHints?: string[];
  /** Grupo de fansub/release: primeiro colchete do início do nome, quando não é uma tag conhecida. */
  group?: string;
  isSpecial?: boolean;
}

export interface ParseOptions {
  /** Série já conhecida pelo chamador (ex.: nome do canal). Libera "E05" solto e vira título quando o texto não traz um. */
  seriesTitle?: string;
}

const applyHits = (out: ParsedMediaName, hits: TagHit[]): void => {
  const audio = new Set<AudioMode>();
  const langs: string[] = [];
  for (const hit of hits) {
    if (hit.kind === 'resolution') out.resolution ??= hit.value;
    else if (hit.kind === 'codec') out.codec ??= hit.value;
    else if (hit.kind === 'source') out.source ??= hit.value;
    else if (hit.kind === 'audio') audio.add(hit.value);
    else if (hit.kind === 'lang' && !langs.includes(hit.value)) langs.push(hit.value);
    else if (hit.kind === 'special') out.isSpecial = true;
  }
  if (audio.has('dual') || (audio.has('dubbed') && audio.has('subtitled'))) out.audio = 'dual';
  else if (audio.has('dubbed')) out.audio = 'dubbed';
  else if (audio.has('subtitled')) out.audio = 'subtitled';
  if (langs.length > 0) out.languageHints = langs;
};

export const parseMediaName = (input: string, opts: ParseOptions = {}): ParsedMediaName => {
  const { toks, hits, bracketYear, group, titleLimit } = tokenizeCaption(input);

  const starts: number[] = [];
  let pos = 0;
  for (const t of toks) {
    starts.push(pos);
    pos += t.word.length + 1;
  }
  const joined = toks.map((t) => t.word).join(' ');
  const structs = findStruct(toks, joined, starts, (tok) => opts.seriesTitle !== undefined || titleBefore(toks, tok));
  const anime = structs.length === 0 ? findAnimeEpisode(toks) : null;
  const found = anime ? [anime] : structs;

  const { boundary, yearTok } = findBoundary(toks, titleLimit, bracketYear !== undefined);
  const titleToks = trimSeparators(toks.slice(0, boundary).filter((t) => t.kind !== 'attr' && t.kind !== 'struct'));
  const title = titleToks.map((t) => t.raw).join(' ') || opts.seriesTitle || '';

  const out: ParsedMediaName = { title };
  const year = bracketYear ?? (yearTok >= 0 ? Number(toks[yearTok]?.word) : undefined);
  if (year !== undefined) out.year = year;
  const season = found.find((s) => s.season !== undefined)?.season;
  const episode = found.find((s) => s.episode !== undefined)?.episode;
  if (season !== undefined) out.season = season;
  if (episode !== undefined) {
    out.episode = episode;
    const end = found.find((s) => s.episodeEnd !== undefined)?.episodeEnd;
    if (end !== undefined && end > episode) out.episodeEnd = end;
  }
  toks.forEach((t, i) => {
    if (t.hit && (t.kind === 'attr' || (t.kind === 'ambig' && i >= boundary))) hits.push(t.hit);
  });
  applyHits(out, hits);
  if (group) out.group = group;
  if (season === 0) out.isSpecial = true;
  return out;
};
