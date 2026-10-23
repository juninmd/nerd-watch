import type { LibraryItem } from '../../repo/library.ts';
import { WATCH_STATUSES, type MediaType, type WatchStatus } from '../../types.ts';
import { CSV_MAX_ROWS, InputError, type RowError } from './common.ts';
import { CsvError, guardCell, parseCsv, toCsv, unguardCell } from './csv.ts';

/** Ordem das colunas no arquivo. Só `title`, `type` e `status` são obrigatórias na importação; as demais podem faltar. */
export const LIBRARY_CSV_COLUMNS = ['title', 'year', 'type', 'status', 'rating', 'current_season', 'current_episode', 'notes', 'tmdb_id', 'added_at'] as const;
const REQUIRED_COLUMNS = ['title', 'type', 'status'] as const;

/** Excel precisa do BOM para ler acentos corretamente; o leitor o remove. */
const BOM = '﻿';
const MAX_TITLE = 300;
const MAX_NOTES = 5000;
const MEDIA_TYPES: MediaType[] = ['movie', 'tv'];

export interface ParsedLibraryRow {
  /** Linha física do arquivo (1-based), para o relatório de erros. */
  row: number;
  title: string;
  /** Ano de lançamento (4 dígitos) ou null. Usado só para casar títulos sem tmdb_id. */
  year: string | null;
  type: MediaType;
  status: WatchStatus;
  /** Campos opcionais: `undefined` quando a coluna não existe no arquivo (a importação não mexe no valor atual). */
  rating?: number | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
  notes?: string | null;
  tmdbId: number | null;
}

export interface ParsedLibrary {
  rows: ParsedLibraryRow[];
  errors: RowError[];
}

/** Uma linha que não passou na validação. Interno: vira RowError e a importação continua. */
class RowValidationError extends Error {}
const invalid = (message: string): never => {
  throw new RowValidationError(message);
};

export const exportLibraryCsv = (items: LibraryItem[]): string => {
  const rows = items.map((item) =>
    [
      item.title.title,
      item.title.release_date?.slice(0, 4) ?? '',
      item.title.media_type,
      item.watch_status,
      item.rating === null ? '' : String(item.rating),
      item.current_season === null ? '' : String(item.current_season),
      item.current_episode === null ? '' : String(item.current_episode),
      item.notes ?? '',
      item.title.source === 'tmdb' ? item.title.source_id : '',
      item.added_at,
    ].map(guardCell),
  );
  return BOM + toCsv([[...LIBRARY_CSV_COLUMNS], ...rows]);
};

const optionalInt = (raw: string, name: string, min: number, max: number): number | null => {
  if (raw === '') return null;
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(n >= min && n <= max)) invalid(`${name} deve ser um inteiro entre ${min} e ${max}`);
  return n;
};

const parseRow = (cells: string[], col: Map<string, number>, row: number): ParsedLibraryRow => {
  const get = (name: string): string => unguardCell(cells[col.get(name) ?? -1] ?? '');
  /** Coluna ausente do arquivo: devolve undefined para o valor atual ficar como está. */
  const optional = <T>(name: string, read: () => T): T | undefined => (col.has(name) ? read() : undefined);
  const title = get('title').trim();
  if (title === '') invalid('título vazio');
  if (title.length > MAX_TITLE) invalid(`título com mais de ${MAX_TITLE} caracteres`);

  const yearRaw = get('year').trim();
  if (yearRaw !== '' && !/^\d{4}$/.test(yearRaw)) invalid('ano deve ter 4 dígitos');

  const type = get('type').trim();
  if (!MEDIA_TYPES.includes(type as MediaType)) invalid('tipo deve ser movie ou tv');

  const status = get('status').trim();
  if (!WATCH_STATUSES.includes(status as WatchStatus)) invalid(`status deve ser um de: ${WATCH_STATUSES.join(', ')}`);

  const notes = get('notes');
  if (notes.length > MAX_NOTES) invalid(`notas com mais de ${MAX_NOTES} caracteres`);

  const tmdbRaw = get('tmdb_id').trim();
  if (tmdbRaw !== '' && !/^[1-9]\d{0,9}$/.test(tmdbRaw)) invalid('tmdb_id deve ser um número positivo');

  return {
    row,
    title,
    year: yearRaw === '' ? null : yearRaw,
    type: type as MediaType,
    status: status as WatchStatus,
    rating: optional('rating', () => optionalInt(get('rating').trim(), 'nota', 0, 10)),
    currentSeason: optional('current_season', () => optionalInt(get('current_season').trim(), 'temporada', 0, 999)),
    currentEpisode: optional('current_episode', () => optionalInt(get('current_episode').trim(), 'episódio', 0, 9999)),
    notes: optional('notes', () => (notes === '' ? null : notes)),
    tmdbId: tmdbRaw === '' ? null : Number(tmdbRaw),
  };
};

/**
 * Lê e valida o CSV. Erro de arquivo (cabeçalho, aspas, teto de linhas) lança InputError (400); erro de linha vai para
 * `errors` e as outras linhas continuam valendo.
 */
export const parseLibraryCsv = (text: string): ParsedLibrary => {
  let records: ReturnType<typeof parseCsv>;
  try {
    records = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) throw new InputError(err.message, 400);
    throw err;
  }
  const [header, ...body] = records;
  if (!header) throw new InputError('arquivo vazio: falta o cabeçalho', 400);

  // Excel em português salva com ponto e vírgula: sem isso o erro seria "faltam colunas", que não explica nada.
  if (header.cells.length === 1 && (header.cells[0] ?? '').includes(';')) {
    throw new InputError('separador ";" não é aceito: separe as colunas com vírgula (,)', 400);
  }

  const col = new Map<string, number>();
  header.cells.forEach((name, index) => {
    const key = name.trim().toLowerCase();
    if (!col.has(key)) col.set(key, index);
  });
  const missing = REQUIRED_COLUMNS.filter((name) => !col.has(name));
  if (missing.length > 0) throw new InputError(`cabeçalho inválido: faltam colunas ${missing.join(', ')}`, 400);
  if (body.length > CSV_MAX_ROWS) throw new InputError(`no máximo ${CSV_MAX_ROWS} linhas por importação`, 400);

  const rows: ParsedLibraryRow[] = [];
  const errors: RowError[] = [];
  for (const record of body) {
    // Linha só com vírgulas ou espaços (planilha editada) é vazia, não erro.
    if (record.cells.every((c) => c.trim() === '')) continue;
    if (record.cells.length !== header.cells.length) {
      errors.push({ row: record.line, message: `esperava ${header.cells.length} colunas, veio ${record.cells.length}` });
      continue;
    }
    try {
      rows.push(parseRow(record.cells, col, record.line));
    } catch (err) {
      if (!(err instanceof RowValidationError)) throw err;
      errors.push({ row: record.line, message: err.message });
    }
  }
  return { rows, errors };
};
