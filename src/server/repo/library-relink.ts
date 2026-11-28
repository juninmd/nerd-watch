import type { Database } from 'bun:sqlite';
import { getLibraryEntryByTitle } from './library.ts';
import { getTitle } from './titles.ts';

const hasTelegramLinks = (db: Database): boolean =>
  db.query<{ name: string }, []>('PRAGMA table_info(telegram_items)').all().some((c) => c.name === 'link_source');

export type RelinkOutcome = { ok: true } | { ok: false; reason: 'not_found' | 'same' | 'conflict' };

/**
 * "Vínculo errado?": move a entrada da biblioteca (status, nota, notas, revisões), o histórico e as listas de um
 * título para outro já gravado em `titles`. Importação por nome (CSV, Trakt) às vezes cai no homônimo errado.
 *
 * O marcador de episódio só faz sentido na mesma série: indo para um filme, ele é zerado. Se o destino já está na
 * biblioteca, nada muda (`conflict`): juntar duas entradas perderia dados de uma delas sem a pessoa decidir.
 * Tudo numa transação: ou move tudo, ou nada.
 */
export const relinkLibraryEntry = (db: Database, fromTitleId: string, toTitleId: string): RelinkOutcome =>
  db.transaction((): RelinkOutcome => {
    if (fromTitleId === toTitleId) return { ok: false, reason: 'same' };
    const entry = getLibraryEntryByTitle(db, fromTitleId);
    const target = getTitle(db, toTitleId);
    if (!entry || !target) return { ok: false, reason: 'not_found' };
    if (getLibraryEntryByTitle(db, toTitleId)) return { ok: false, reason: 'conflict' };
    const now = new Date().toISOString();
    const keepMarker = target.media_type === 'tv';
    db.query(
      `UPDATE library_entries SET title_id = ?, updated_at = ?,
         current_season = CASE WHEN ? THEN current_season ELSE NULL END,
         current_episode = CASE WHEN ? THEN current_episode ELSE NULL END
       WHERE id = ?`,
    ).run(toTitleId, now, keepMarker ? 1 : 0, keepMarker ? 1 : 0, entry.id);
    db.query('UPDATE library_history SET title_id = ? WHERE title_id = ?').run(toTitleId, fromTitleId);
    // Lista que já tinha o destino fica com ele; a linha antiga sai para não sobrar o título errado.
    db.query('UPDATE OR IGNORE list_items SET title_id = ? WHERE title_id = ?').run(toTitleId, fromTitleId);
    db.query('DELETE FROM list_items WHERE title_id = ?').run(fromTitleId);
    // Vínculo de vídeo do Telegram feito à mão acompanha a troca (o automático é refeito depois, pelo nome).
    if (hasTelegramLinks(db)) {
      db.query("UPDATE telegram_items SET title_id = ? WHERE title_id = ? AND link_source = 'manual'").run(toTitleId, fromTitleId);
    }
    return { ok: true };
  })();
