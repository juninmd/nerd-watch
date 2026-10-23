import type { Database } from 'bun:sqlite';
import { getLibraryEntryByTitle, type LibraryItem, listLibrary, upsertLibraryEntry } from '../../repo/library.ts';
import { findTmdbTitles, upsertTitle } from '../../repo/titles.ts';
import type { LibraryEntryRow, MediaType, TitleRow, WatchStatus } from '../../types.ts';
import type { RowError } from './common.ts';
import { type ParsedLibraryRow, parseLibraryCsv } from './library-csv.ts';

export interface LibraryImportReport {
  /** Títulos novos na lista. */
  imported: number;
  /** Entradas que já existiam e mudaram. */
  updated: number;
  /** Entradas que já estavam exatamente assim: reimportar o mesmo arquivo cai aqui. */
  unchanged: number;
  /** Linhas recusadas (o mesmo número de `errors`). */
  failed: number;
  errors: RowError[];
}

/** Falha de uma linha (não do arquivo): vira RowError e a importação segue. */
class RowFailure extends Error {}
const fail = (message: string): never => {
  throw new RowFailure(message);
};

/** Chave de casamento por nome: tipo e título sem diferença de caixa, espaço nas pontas ou forma Unicode. */
const nameKey = (type: MediaType, title: string): string => JSON.stringify([type, title.normalize('NFC').trim().toLowerCase()]);

const yearOf = (item: LibraryItem): string => item.title.release_date?.slice(0, 4) ?? '';

const indexByName = (items: LibraryItem[]): Map<string, LibraryItem[]> => {
  const index = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const key = nameKey(item.title.media_type, item.title.title);
    index.set(key, [...(index.get(key) ?? []), item]);
  }
  return index;
};

/** Campos ausentes (undefined) não entram na comparação nem na gravação: a coluna não veio no arquivo. */
const sameEntry = (entry: LibraryEntryRow, next: Patch): boolean =>
  entry.watch_status === next.watchStatus &&
  (next.rating === undefined || entry.rating === next.rating) &&
  (next.notes === undefined || entry.notes === next.notes) &&
  (next.currentSeason === undefined || entry.current_season === next.currentSeason) &&
  (next.currentEpisode === undefined || entry.current_episode === next.currentEpisode);

/** O que gravar. Campo `undefined` = manter o valor atual (o repositório trata undefined assim). */
interface Patch {
  watchStatus: WatchStatus;
  rating?: number | null;
  notes?: string | null;
  currentSeason?: number | null;
  currentEpisode?: number | null;
}

/**
 * Aplica um CSV de biblioteca. Idempotente: a chave é o tmdb_id quando a linha tem um; sem ele, casa com um título que já
 * está na biblioteca por nome+tipo+ano, e nunca cria identidade inventada. O que está no arquivo é o estado final
 * (sobrescreve status, nota, notas e progresso). Linhas ruins viram erro e as boas são gravadas, numa transação só.
 */
export const importLibraryCsv = (db: Database, text: string): LibraryImportReport => {
  const { rows, errors } = parseLibraryCsv(text);
  const tmdbTitles = new Map(findTmdbTitles(db, rows.flatMap((r) => (r.tmdbId === null ? [] : [String(r.tmdbId)]))).map((t) => [t.source_id, t]));
  const byName = rows.some((r) => r.tmdbId === null) ? indexByName(listLibrary(db)) : new Map<string, LibraryItem[]>();
  const report: LibraryImportReport = { imported: 0, updated: 0, unchanged: 0, failed: 0, errors: [...errors] };
  const touched = new Set<string>();

  db.transaction(() => {
    for (const row of rows) {
      try {
        const title = resolveTitle(row, tmdbTitles, byName);
        const key = title?.id ?? `tmdb:${row.tmdbId}`;
        if (touched.has(key)) fail('linha duplicada no arquivo: a primeira ocorrência vale');
        touched.add(key);

        const target = title ?? upsertTitle(db, { source: 'tmdb', sourceId: String(row.tmdbId), mediaType: row.type, title: row.title });
        const patch = toPatch(row);
        const entry = getLibraryEntryByTitle(db, target.id);
        if (entry && sameEntry(entry, patch)) {
          report.unchanged++;
          continue;
        }
        upsertLibraryEntry(db, target.id, patch);
        if (entry) report.updated++;
        else report.imported++;
      } catch (err) {
        if (!(err instanceof RowFailure)) throw err;
        report.errors.push({ row: row.row, message: err.message });
      }
    }
  })();

  report.errors.sort((a, b) => a.row - b.row);
  report.failed = report.errors.length;
  return report;
};

/** Título já existente para a linha, ou null quando a linha cria um título TMDB novo. Recusa o que não casa com certeza. */
const resolveTitle = (row: ParsedLibraryRow, tmdbTitles: Map<string, TitleRow>, byName: Map<string, LibraryItem[]>): TitleRow | null => {
  if (row.tmdbId !== null) {
    const found = tmdbTitles.get(String(row.tmdbId));
    if (found && found.media_type !== row.type) fail('este tmdb_id já está na biblioteca como outro tipo (filme ou série)');
    return found ?? null;
  }
  // Sem ano na linha, casa só pelo nome e tipo; com ano, o ano precisa bater também.
  const matches = (byName.get(nameKey(row.type, row.title)) ?? []).filter((item) => row.year === null || yearOf(item) === row.year);
  if (matches.length === 0) fail('sem tmdb_id e nenhum título da biblioteca com este nome, tipo e ano: inclua tmdb_id');
  if (matches.length > 1) fail('ambíguo: mais de um título da biblioteca com este nome, tipo e ano; inclua tmdb_id');
  return matches[0]?.title ?? null;
};

const toPatch = (row: ParsedLibraryRow): Patch => {
  const patch: Patch = { watchStatus: row.status };
  if (row.rating !== undefined) patch.rating = row.rating;
  if (row.notes !== undefined) patch.notes = row.notes;
  if (row.currentSeason !== undefined) patch.currentSeason = row.currentSeason;
  if (row.currentEpisode !== undefined) patch.currentEpisode = row.currentEpisode;
  return patch;
};
