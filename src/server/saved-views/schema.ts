import { hasControlChar } from '../text-guards.ts';
import { WATCH_STATUSES } from '../types.ts';
import { ValidationError } from '../validation-error.ts';

/**
 * Visão salva da biblioteca: só combinações destes valores fixos. Nada do cliente vira SQL: o filtro é aplicado
 * em memória sobre a lista já carregada, e a validação é uma lista branca de chaves e valores.
 */
export const SAVED_VIEW_STATUSES = ['all', ...WATCH_STATUSES] as const;
export const SAVED_VIEW_SOURCES = ['all', 'tmdb', 'archive', 'tvmaze', 'anilist', 'telegram'] as const;
export const SAVED_VIEW_LAYOUTS = ['grid', 'list'] as const;
export const SAVED_VIEW_SORTS = ['recent', 'title', 'rating'] as const;

export type SavedViewStatus = (typeof SAVED_VIEW_STATUSES)[number];
export type SavedViewSource = (typeof SAVED_VIEW_SOURCES)[number];
export type SavedViewLayout = (typeof SAVED_VIEW_LAYOUTS)[number];
export type SavedViewSort = (typeof SAVED_VIEW_SORTS)[number];

export interface LibraryViewQuery {
  status: SavedViewStatus;
  source: SavedViewSource;
  layout: SavedViewLayout;
  sort: SavedViewSort;
}

export const DEFAULT_VIEW_QUERY: LibraryViewQuery = { status: 'all', source: 'all', layout: 'grid', sort: 'recent' };

export const SAVED_VIEW_NAME_MAX = 40;
/** Teto do JSON guardado: a combinação tem 4 campos curtos; qualquer coisa acima disso não é uma visão. */
export const SAVED_VIEW_QUERY_MAX_CHARS = 512;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valida a combinação vinda do cliente ou de um backup. Chaves ausentes assumem o padrão; chaves extras são erro. */
export const parseViewQuery = (raw: unknown): LibraryViewQuery => {
  if (!isPlainObject(raw)) throw new ValidationError('visão deve ser um objeto com status, source, layout e sort');
  if (JSON.stringify(raw).length > SAVED_VIEW_QUERY_MAX_CHARS) throw new ValidationError('visão grande demais');
  const allowed = new Set(Object.keys(DEFAULT_VIEW_QUERY));
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new ValidationError(`campo desconhecido na visão: ${key}`);

  const pick = <T extends string>(key: keyof LibraryViewQuery, values: readonly T[]): T => {
    // Só ausente usa o padrão; null explícito é erro de tipo.
    const value = raw[key] === undefined ? DEFAULT_VIEW_QUERY[key] : raw[key];
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) throw new ValidationError(`${key} inválido na visão`);
    return value as T;
  };

  return {
    status: pick('status', SAVED_VIEW_STATUSES),
    source: pick('source', SAVED_VIEW_SOURCES),
    layout: pick('layout', SAVED_VIEW_LAYOUTS),
    sort: pick('sort', SAVED_VIEW_SORTS),
  };
};

/** Texto canônico (chaves sempre na mesma ordem): mesma combinação, mesmo JSON. */
export const serializeViewQuery = (query: LibraryViewQuery): string =>
  JSON.stringify({ status: query.status, source: query.source, layout: query.layout, sort: query.sort });

/** Lê o JSON guardado (linha da tabela ou backup) e aplica a mesma validação de entrada. */
export const parseStoredViewQuery = (text: string): LibraryViewQuery => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError('visão guardada não é JSON válido');
  }
  return parseViewQuery(parsed);
};

/** Nome da visão: 1 a 40 caracteres, aparado, sem controle. */
export const parseViewName = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new ValidationError('nome da visão deve ser texto');
  const name = raw.trim();
  if (name === '') throw new ValidationError('nome da visão não pode ser vazio');
  if ([...name].length > SAVED_VIEW_NAME_MAX) throw new ValidationError(`nome da visão com mais de ${SAVED_VIEW_NAME_MAX} caracteres`);
  if (hasControlChar(name)) throw new ValidationError('nome da visão não aceita caracteres de controle');
  return name;
};
