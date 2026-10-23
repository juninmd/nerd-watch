import type { Database } from 'bun:sqlite';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../../repo/library.ts';
import type { TitleRow, WatchStatus } from '../../types.ts';
import type { RowError } from './common.ts';
import { type MalEntry, parseMalAnimeList } from './mal-xml.ts';

/** Descobre o título do app para um id do MyAnimeList. Injetado: a rota usa o padrão offline, os testes trocam. */
export type MalTitleResolver = (malId: number) => TitleRow | null;

/**
 * Sem tabela MAL -> título no repositório, não há como saber offline qual título é qual. O padrão não chuta:
 * todas as entradas vão para `unresolved`. Títulos AniList guardam o id do AniList, que não é o id do MAL.
 */
export const resolveMalTitleOffline: MalTitleResolver = () => null;

export interface MalUnresolved {
  row: number;
  malId: number;
  title: string;
  watchStatus: WatchStatus;
}

export interface MalImportReport {
  /** Entradas válidas lidas do arquivo (as inválidas estão em `errors`). */
  entries: number;
  imported: number;
  updated: number;
  unchanged: number;
  unresolved: MalUnresolved[];
  errors: RowError[];
}

/**
 * Importa a lista do MyAnimeList para a biblioteca. Só grava o que tem título resolvido: status e nota (sem nota no MAL
 * não mexe na nota existente). Progresso de episódio não é gravado: o MAL conta episódios por entrada, não por temporada.
 */
export const importMalAnimeList = (db: Database, xml: string, resolveTitle: MalTitleResolver = resolveMalTitleOffline): MalImportReport => {
  const { entries, errors } = parseMalAnimeList(xml);
  const report: MalImportReport = { entries: entries.length, imported: 0, updated: 0, unchanged: 0, unresolved: [], errors };
  const touched = new Set<string>();

  db.transaction(() => {
    for (const entry of entries) {
      const title = resolveTitle(entry.malId);
      if (!title) {
        report.unresolved.push(unresolved(entry));
        continue;
      }
      if (touched.has(title.id)) {
        report.errors.push({ row: entry.row, message: 'linha duplicada: outra entrada do MAL já corresponde a este título' });
        continue;
      }
      touched.add(title.id);

      const current = getLibraryEntryByTitle(db, title.id);
      if (current && current.watch_status === entry.watchStatus && (entry.rating === null || current.rating === entry.rating)) {
        report.unchanged++;
        continue;
      }
      upsertLibraryEntry(db, title.id, { watchStatus: entry.watchStatus, ...(entry.rating === null ? {} : { rating: entry.rating }) });
      if (current) report.updated++;
      else report.imported++;
    }
  })();

  report.errors.sort((a, b) => a.row - b.row);
  return report;
};

const unresolved = (entry: MalEntry): MalUnresolved => ({
  row: entry.row,
  malId: entry.malId,
  title: entry.title,
  watchStatus: entry.watchStatus,
});
