import type { Database } from 'bun:sqlite';
import type { LibraryHistoryKind, LibraryHistoryRow, WatchStatus } from '../types.ts';

export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 100;

export interface HistoryPage {
  limit: number;
  offset: number;
}

const DIGITS = /^\d+$/;

/** Limite e offset vindos da query: inteiros, limite entre 1 e o máximo, offset não negativo. `null` = inválido. */
export const parseHistoryPage = (limitRaw: string | undefined, offsetRaw: string | undefined): HistoryPage | null => {
  const limit = limitRaw === undefined ? HISTORY_DEFAULT_LIMIT : DIGITS.test(limitRaw) ? Number(limitRaw) : Number.NaN;
  const offset = offsetRaw === undefined ? 0 : DIGITS.test(offsetRaw) ? Number(offsetRaw) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) return null;
  if (!Number.isSafeInteger(offset)) return null;
  return { limit, offset };
};

const insertEvent = (db: Database, titleId: string, kind: LibraryHistoryKind, at: string, detail: string | null): void => {
  db.query('INSERT INTO library_history (id, title_id, kind, at, detail) VALUES ($id, $titleId, $kind, $at, $detail)').run({
    $id: crypto.randomUUID(),
    $titleId: titleId,
    $kind: kind,
    $at: at,
    $detail: detail,
  });
};

/** Tipo do evento de uma troca de status; `null` quando o status não mudou (nada a registrar). */
export const statusEventKind = (from: WatchStatus, to: WatchStatus): { kind: LibraryHistoryKind; detail: string | null } | null => {
  if (from === to) return null;
  if (to === 'watching') return { kind: 'started', detail: null };
  if (to === 'watched') return { kind: 'finished', detail: null };
  if (to === 'dropped') return { kind: 'dropped', detail: null };
  return { kind: 'status_changed', detail: `${from}->${to}` };
};

export const recordAdded = (db: Database, titleId: string, at: string): void => insertEvent(db, titleId, 'added', at, null);

export const recordStatusChange = (db: Database, titleId: string, from: WatchStatus, to: WatchStatus, at: string): void => {
  const event = statusEventKind(from, to);
  if (event) insertEvent(db, titleId, event.kind, at, event.detail);
};

/** Progresso só é registrado quando temporada ou episódio realmente muda. */
export const recordProgress = (db: Database, titleId: string, season: number | null, episode: number | null, at: string): void => {
  const parts = [season !== null ? `T${season}` : null, episode !== null ? `E${episode}` : null].filter((p) => p !== null);
  insertEvent(db, titleId, 'progress', at, parts.length > 0 ? parts.join(' ') : null);
};

export const recordRewatchStarted = (db: Database, titleId: string, at: string): void => insertEvent(db, titleId, 'rewatch_started', at, null);

export interface HistoryListing {
  items: LibraryHistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Mais novo primeiro; `rowid` desempata eventos com o mesmo instante (gravados na mesma transação). */
export const listLibraryHistory = (db: Database, titleId: string, page: HistoryPage): HistoryListing => {
  const items = db
    .query<LibraryHistoryRow, [string, number, number]>(
      'SELECT id, title_id, kind, at, detail FROM library_history WHERE title_id = ? ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?',
    )
    .all(titleId, page.limit, page.offset);
  const total = db.query<{ n: number }, [string]>('SELECT COUNT(*) as n FROM library_history WHERE title_id = ?').get(titleId)?.n ?? 0;
  return { items, total, limit: page.limit, offset: page.offset };
};
