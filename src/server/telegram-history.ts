import type { Database } from 'bun:sqlite';
import { fetchPersonalVideoPage } from './providers/telegram/personal.ts';
import { fetchPublicChannelPage } from './providers/telegram/public.ts';
import {
  countTelegramItems,
  HISTORY_END,
  oldestStoredMessageId,
  type NewTelegramItem,
  type TelegramChannel,
  updateChannelCursor,
  upsertTelegramItems,
} from './repo/telegram.ts';
import { localizeThumbs } from './telegram-item-thumbs.ts';

/** Modos que têm histórico para ler pra trás e busca de texto (o bot só recebe o que for postado dali em diante). */
export const hasHistory = (mode: TelegramChannel['mode']): boolean => mode === 'personal' || mode === 'public';

export interface HistoryPage {
  items: NewTelegramItem[];
  /** Menor id de mensagem da página: de onde a próxima continua. */
  oldestId: string | null;
  exhausted: boolean;
}

/** A prévia pública não diz "acabou": sem post nenhum, ou já no post 1, não há mais nada antes. */
export const publicHistoryExhausted = (oldestId: string | null): boolean => oldestId === null || Number(oldestId) <= 1;

export const fetchHistoryPage = async (channel: Pick<TelegramChannel, 'mode' | 'handle'>, opts: { before?: string; query?: string } = {}): Promise<HistoryPage> => {
  if (channel.mode === 'personal') return fetchPersonalVideoPage(channel.handle, opts);
  const page = await fetchPublicChannelPage(channel.handle, opts);
  return { items: page.items, oldestId: page.oldestId, exhausted: publicHistoryExhausted(page.oldestId) };
};

/** Cursor depois de ler uma página: o fim do histórico se acabou ou se a página não andou pra trás (evita repetir sem fim). */
export const nextCursor = (page: Pick<HistoryPage, 'oldestId' | 'exhausted'>, before: string | null): string | null =>
  page.exhausted || page.oldestId === null || (before !== null && Number(page.oldestId) >= Number(before)) ? HISTORY_END : page.oldestId;

export type HistoryOutcome<T> = { ok: true; value: T } | { ok: false; status: 409; error: string };

/** Um canal por vez: dois cliques seguidos não podem pedir a mesma página duas vezes ao Telegram. */
const busy = new Set<string>();

const exclusive = async <T>(channelId: string, work: () => Promise<T>): Promise<HistoryOutcome<T>> => {
  if (busy.has(channelId)) return { ok: false, status: 409, error: 'esse canal já está carregando — espere terminar' };
  busy.add(channelId);
  try {
    return { ok: true, value: await work() };
  } finally {
    busy.delete(channelId);
  }
};

export interface LoadMoreResult {
  added: number;
  total: number;
  exhausted: boolean;
}

/** Lê a próxima página de vídeos mais antigos e avança o cursor. */
export const loadMoreHistory = (db: Database, channel: TelegramChannel): Promise<HistoryOutcome<LoadMoreResult>> =>
  exclusive(channel.id, async () => {
    const stored = countTelegramItems(db, channel.id);
    if (channel.cursor === HISTORY_END) return { added: 0, total: stored, exhausted: true };

    const before = channel.cursor && /^\d+$/.test(channel.cursor) ? channel.cursor : oldestStoredMessageId(db, channel.id);
    const page = await fetchHistoryPage(channel, before ? { before } : {});
    const saved = upsertTelegramItems(db, channel.id, page.items);
    await localizeThumbs(db, channel, saved);
    const cursor = nextCursor(page, before);
    updateChannelCursor(db, channel.id, cursor);
    return { added: saved.length - stored, total: saved.length, exhausted: cursor === HISTORY_END };
  });

export interface SearchResult {
  found: number;
  added: number;
  total: number;
}

/**
 * Busca o texto no canal inteiro (no Telegram, não só no que já foi importado) e guarda os achados na lista.
 * Não mexe no cursor: a leitura do histórico continua de onde estava, e o achado antigo aparece no seu lugar pelo id.
 */
export const searchHistory = (db: Database, channel: TelegramChannel, query: string): Promise<HistoryOutcome<SearchResult>> =>
  exclusive(channel.id, async () => {
    const stored = countTelegramItems(db, channel.id);
    const page = await fetchHistoryPage(channel, { query });
    const saved = upsertTelegramItems(db, channel.id, page.items);
    await localizeThumbs(db, channel, saved);
    return { found: page.items.length, added: saved.length - stored, total: saved.length };
  });
