import { json } from './http.ts';

export const exportBackup = (): Promise<unknown> => fetch('/api/backup').then((r) => json<unknown>(r));

export interface ImportBackupResponse {
  imported: { titles: number; seasons: number; episodes: number; libraryEntries: number };
}

export const importBackup = (data: unknown): Promise<ImportBackupResponse> =>
  fetch('/api/backup/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then((r) => json<ImportBackupResponse>(r));

export const exportLibraryCsv = (): Promise<Blob> =>
  fetch('/api/library/export.csv').then(async (r) => {
    if (!r.ok) throw new Error(`erro ${r.status} ao exportar`);
    return r.blob();
  });

export interface LibraryRowError {
  row: number;
  message: string;
}

export interface LibraryCsvReport {
  imported: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors: LibraryRowError[];
}

export const importLibraryCsv = (text: string): Promise<LibraryCsvReport> =>
  fetch('/api/library/import.csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    body: text,
  }).then((r) => json<LibraryCsvReport>(r));

export interface MalUnresolvedEntry {
  row: number;
  malId: number;
  title: string;
  watchStatus: string;
}

export interface MalImportReport {
  entries: number;
  imported: number;
  updated: number;
  unchanged: number;
  unresolved: MalUnresolvedEntry[];
  errors: LibraryRowError[];
}

export const importMalList = (xml: string): Promise<MalImportReport> =>
  fetch('/api/library/import.mal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: xml,
  }).then((r) => json<MalImportReport>(r));
