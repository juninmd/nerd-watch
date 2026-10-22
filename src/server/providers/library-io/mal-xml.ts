import type { WatchStatus } from '../../types.ts';
import { InputError, MAL_MAX_ENTRIES, type RowError } from './common.ts';
import { childrenNamed, childText, parseXml, XmlError, type XmlNode } from '../xml/minixml.ts';

export interface MalEntry {
  /** Posição da entrada no arquivo (1-based), para o relatório. */
  row: number;
  /** series_animedb_id: o id do MyAnimeList. É o único identificador usado. */
  malId: number;
  /** series_title, só para mostrar ao usuário; nunca usado para casar títulos. */
  title: string;
  watchStatus: WatchStatus;
  /** my_score de 1 a 10, ou null quando não há nota (0 no MAL significa "sem nota"). */
  rating: number | null;
}

export interface ParsedMal {
  entries: MalEntry[];
  errors: RowError[];
}

/** my_status do MAL -> status do app. "On-Hold" vira "watching": o app não tem "pausado" e o título segue em andamento. */
const MAL_STATUS: Record<string, WatchStatus> = {
  watching: 'watching',
  completed: 'watched',
  'on-hold': 'watching',
  dropped: 'dropped',
  'plan to watch': 'want',
};

const MAX_TITLE = 300;
/** Cada <anime> tem uns 25 nós (campos e textos); com MAL_MAX_ENTRIES entradas o teto precisa acompanhar. */
const MAL_MAX_NODES = MAL_MAX_ENTRIES * 40;

class EntryError extends Error {}
const invalid = (message: string): never => {
  throw new EntryError(message);
};

const parseEntry = (node: XmlNode, row: number): MalEntry => {
  const idRaw = childText(node, 'series_animedb_id') ?? '';
  if (!/^[1-9]\d{0,9}$/.test(idRaw)) invalid('series_animedb_id ausente ou inválido');

  const statusRaw = childText(node, 'my_status') ?? '';
  if (statusRaw === '') invalid('my_status ausente');
  const watchStatus = MAL_STATUS[statusRaw.toLowerCase()] ?? invalid(`my_status desconhecido: ${statusRaw.slice(0, 40)}`);

  const scoreRaw = childText(node, 'my_score') ?? '';
  let rating: number | null = null;
  if (scoreRaw !== '' && scoreRaw !== '0') {
    const score = /^\d{1,2}$/.test(scoreRaw) ? Number(scoreRaw) : Number.NaN;
    if (!(score >= 1 && score <= 10)) invalid('my_score deve ser um inteiro de 0 a 10');
    rating = score;
  }

  return {
    row,
    malId: Number(idRaw),
    title: (childText(node, 'series_title') ?? '').slice(0, MAX_TITLE),
    watchStatus,
    rating,
  };
};

/**
 * Lê o XML exportado pelo MyAnimeList (`<myanimelist><anime>...`). DOCTYPE e declarações de entidade são recusados pelo
 * leitor (400), sem resolver nada: nada de entidade externa, nada de expansão. Erro de entrada vira RowError.
 */
export const parseMalAnimeList = (xml: string): ParsedMal => {
  let root: XmlNode;
  try {
    root = parseXml(xml, MAL_MAX_NODES);
  } catch (err) {
    if (err instanceof XmlError) throw new InputError(`XML inválido: ${err.message}`, 400);
    throw err;
  }
  if (root.name !== 'myanimelist') throw new InputError('raiz inválida: o arquivo deve ser uma exportação <myanimelist> do MyAnimeList', 400);

  const animes = childrenNamed(root, 'anime');
  if (animes.length > MAL_MAX_ENTRIES) throw new InputError(`no máximo ${MAL_MAX_ENTRIES} entradas por importação`, 400);

  const entries: MalEntry[] = [];
  const errors: RowError[] = [];
  animes.forEach((node, index) => {
    try {
      entries.push(parseEntry(node, index + 1));
    } catch (err) {
      if (!(err instanceof EntryError)) throw err;
      errors.push({ row: index + 1, message: err.message });
    }
  });
  return { entries, errors };
};
