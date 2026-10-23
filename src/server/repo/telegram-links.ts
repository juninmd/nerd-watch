import type { Database } from 'bun:sqlite';
import { type LinkCandidate, type LinkDecision, matchParsedName } from '../media-name/match.ts';
import { parseMediaName } from '../media-name/parse.ts';
import type { TelegramItemRow, TitleSource } from '../types.ts';

/** Vínculo de um vídeo do canal com um episódio da biblioteca, como a API e a UI o veem. */
export interface ItemLink {
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeEnd: number | null;
  status: 'suggested' | 'linked';
  source: 'auto' | 'manual';
  confidence: number | null;
}

/** Vínculo escolhido pelo usuário: sempre confirmado (`linked`, origem `manual`). */
export interface ManualLink {
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeEnd?: number;
}

/**
 * Títulos da biblioteca (séries) com os episódios conhecidos. Só a biblioteca: nunca casa com o que o usuário não sigue.
 * Duas consultas no total (títulos e episódios), sem N+1.
 */
export const listLinkCandidates = (db: Database): LinkCandidate[] => {
  const titles = db
    .query<{ id: string; title: string; original_title: string | null; release_date: string | null }, []>(
      `SELECT DISTINCT t.id, t.title, t.original_title, t.release_date
       FROM titles t JOIN library_entries le ON le.title_id = t.id
       WHERE t.media_type = 'tv'`,
    )
    .all();
  const episodes = db
    .query<{ title_id: string; season_number: number; episode_number: number }, []>(
      `SELECT s.title_id, s.season_number, e.episode_number
       FROM seasons s JOIN episodes e ON e.season_id = s.id
       WHERE s.title_id IN (SELECT le.title_id FROM library_entries le JOIN titles t ON t.id = le.title_id WHERE t.media_type = 'tv')`,
    )
    .all();
  const byTitle = new Map<string, LinkCandidate['episodes']>();
  for (const e of episodes) {
    const list = byTitle.get(e.title_id) ?? [];
    list.push({ season: e.season_number, episode: e.episode_number });
    byTitle.set(e.title_id, list);
  }
  return titles.map((t) => ({
    titleId: t.id,
    title: t.title,
    originalTitle: t.original_title,
    year: t.release_date && /^\d{4}/.test(t.release_date) ? Number(t.release_date.slice(0, 4)) : null,
    episodes: byTitle.get(t.id) ?? [],
  }));
};

/** Nome do arquivo primeiro (mais estável que a legenda); a legenda só entra quando o arquivo não casa. */
export const decideItemLink = (
  item: Pick<TelegramItemRow, 'file_name' | 'caption'>,
  candidates: LinkCandidate[],
): LinkDecision => {
  const fromFile = item.file_name ? matchParsedName(parseMediaName(item.file_name), candidates) : null;
  if (fromFile && fromFile.status !== 'unlinked') return fromFile;
  const fromCaption = item.caption ? matchParsedName(parseMediaName(item.caption), candidates) : null;
  if (fromCaption && fromCaption.status !== 'unlinked') return fromCaption;
  return fromFile ?? fromCaption ?? { status: 'unlinked', reason: 'no_name' };
};

const AUTO_WRITE = `UPDATE telegram_items SET title_id = $titleId, season_number = $season, episode_number = $episode,
  episode_end = $episodeEnd, link_status = $status, link_source = $source, link_confidence = $confidence WHERE id = $id`;

/**
 * Recalcula o vínculo automático dos vídeos do canal (ou só de `messageIds`, na importação). Pula os decididos pelo
 * usuário (`link_source = 'manual'`), então rodar de novo não muda o que ele confirmou ou recusou. Idempotente.
 */
export const refreshChannelLinks = (
  db: Database,
  channelId: string,
  messageIds?: string[],
): { linked: number; suggested: number; unlinked: number } => refreshWithCandidates(db, channelId, listLinkCandidates(db), messageIds);

/** Recalcula o vínculo de todos os canais (ao mudar a biblioteca: um título novo pode casar com vídeos antigos). Candidatos lidos uma vez. */
export const refreshAllChannelLinks = (db: Database): void => {
  const candidates = listLinkCandidates(db);
  const ids = db.query<{ id: string }, []>('SELECT id FROM telegram_channels').all();
  for (const { id } of ids) refreshWithCandidates(db, id, candidates);
};

const refreshWithCandidates = (
  db: Database,
  channelId: string,
  candidates: LinkCandidate[],
  messageIds?: string[],
): { linked: number; suggested: number; unlinked: number } => {
  const only = messageIds ? new Set(messageIds) : null;
  const items = db
    .query<TelegramItemRow, [string]>(
      "SELECT * FROM telegram_items WHERE channel_id = ? AND (link_source IS NULL OR link_source = 'auto')",
    )
    .all(channelId)
    .filter((i) => !only || only.has(i.message_id));
  const write = db.query(AUTO_WRITE);
  const counts = { linked: 0, suggested: 0, unlinked: 0 };
  db.transaction(() => {
    for (const item of items) {
      const d = decideItemLink(item, candidates);
      if (d.status === 'unlinked') {
        db.query(
          `UPDATE telegram_items SET title_id = NULL, season_number = NULL, episode_number = NULL, episode_end = NULL,
           link_status = NULL, link_source = NULL, link_confidence = NULL WHERE id = ?`,
        ).run(item.id);
        counts.unlinked++;
        continue;
      }
      write.run({
        $id: item.id,
        $titleId: d.titleId,
        $season: d.season,
        $episode: d.episode,
        $episodeEnd: d.episodeEnd ?? null,
        $status: d.status,
        $source: 'auto',
        $confidence: d.confidence,
      });
      counts[d.status]++;
    }
  })();
  return counts;
};

/**
 * Grava a decisão do usuário. `null` = "sem vínculo", marcado como `manual` para o automático não o sugerir de novo.
 * Devolve false quando o vídeo não existe no canal.
 */
export const setItemLink = (db: Database, channelId: string, messageId: string, link: ManualLink | null): boolean =>
  db.transaction((): boolean => {
    const item = db
      .query<{ id: string }, [string, string]>('SELECT id FROM telegram_items WHERE channel_id = ? AND message_id = ?')
      .get(channelId, messageId);
    if (!item) return false;
    if (!link) {
      db.query(
        `UPDATE telegram_items SET title_id = NULL, season_number = NULL, episode_number = NULL, episode_end = NULL,
         link_status = NULL, link_source = 'manual', link_confidence = NULL WHERE id = ?`,
      ).run(item.id);
      return true;
    }
    const end = link.episodeEnd !== undefined && link.episodeEnd > link.episodeNumber ? link.episodeEnd : null;
    db.query(
      `UPDATE telegram_items SET title_id = $titleId, season_number = $season, episode_number = $episode, episode_end = $episodeEnd,
       link_status = 'linked', link_source = 'manual', link_confidence = 1 WHERE id = $id`,
    ).run({
      $id: item.id,
      $titleId: link.titleId,
      $season: link.seasonNumber,
      $episode: link.episodeNumber,
      $episodeEnd: end,
    });
    return true;
  })();

/** Confirma de uma vez todas as sugestões do canal (viram `linked`, origem `manual`: o usuário confirmou). */
export const acceptChannelSuggestions = (db: Database, channelId: string): number =>
  db
    .query(
      "UPDATE telegram_items SET link_status = 'linked', link_source = 'manual' WHERE channel_id = ? AND link_status = 'suggested'",
    )
    .run(channelId).changes;

/** Títulos vinculados (nome e pôster), numa consulta só, para a lista de vídeos do canal. */
export interface LinkedTitleInfo {
  id: string;
  title: string;
  source: TitleSource;
  posterPath: string | null;
}

export const loadLinkedTitles = (db: Database, titleIds: string[]): Map<string, LinkedTitleInfo> => {
  const ids = [...new Set(titleIds)];
  if (ids.length === 0) return new Map();
  const rows = db
    .query<{ id: string; title: string; source: TitleSource; poster_path: string | null }, string[]>(
      `SELECT id, title, source, poster_path FROM titles WHERE id IN (${ids.map(() => '?').join(', ')})`,
    )
    .all(...ids);
  return new Map(rows.map((r) => [r.id, { id: r.id, title: r.title, source: r.source, posterPath: r.poster_path }]));
};

/** Vínculo do vídeo na forma da API; nulo quando não há vínculo (ou o título saiu do banco). */
export const itemLinkFromRow = (row: TelegramItemRow): ItemLink | null => {
  if (!row.title_id || !row.link_status || row.season_number === null || row.episode_number === null) return null;
  return {
    titleId: row.title_id,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    episodeEnd: row.episode_end,
    status: row.link_status,
    source: row.link_source === 'manual' ? 'manual' : 'auto',
    confidence: row.link_confidence,
  };
};
