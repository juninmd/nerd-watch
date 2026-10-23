import { Hono } from 'hono';
import { telegramPersonalEnabled } from '../config.ts';
import { getDb } from '../db.ts';
import { PrivateChannelNotFoundError } from '../providers/telegram/peer.ts';
import { TelegramFloodWaitError, floodWaitResponse } from '../providers/telegram/flood-wait.ts';
import { TelegramPersonalNotConfiguredError } from '../providers/telegram/personal.ts';
import { TelegramChannelNotFoundError } from '../providers/telegram/public.ts';
import { getTelegramChannel } from '../repo/telegram.ts';
import { hasHistory, loadMoreHistory, searchHistory } from '../telegram-history.ts';

export const SEARCH_MAX_CHARS = 100;

/** Rotas de histórico do canal: montadas em `/channels` pelo roteador do Telegram. */
export const telegramHistoryRoutes = new Hono();

/** Traduz as falhas do Telegram para o mesmo vocabulário de status das outras rotas do canal. */
const failure = (err: unknown): { error: string; status: 404 | 501 | 502 } => {
  if (err instanceof TelegramPersonalNotConfiguredError) return { error: err.message, status: 501 };
  if (err instanceof PrivateChannelNotFoundError || err instanceof TelegramChannelNotFoundError) return { error: err.message, status: 404 };
  return { error: 'não foi possível ler o Telegram agora', status: 502 };
};

telegramHistoryRoutes.post('/:id/load-more', async (c) => {
  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);
  if (!hasHistory(channel.mode)) return c.json({ error: `o modo "${channel.mode}" não tem histórico para carregar (o bot só recebe o que for postado a partir de agora)` }, 501);
  if (channel.mode === 'personal' && !telegramPersonalEnabled()) return c.json({ error: 'conta pessoal do Telegram não configurada — entre com o QR code em Conexões' }, 501);
  try {
    const outcome = await loadMoreHistory(db, channel);
    return outcome.ok ? c.json(outcome.value) : c.json({ error: outcome.error }, outcome.status);
  } catch (err) {
    if (err instanceof TelegramFloodWaitError) return floodWaitResponse(c, err);
    const { error, status } = failure(err);
    return c.json({ error }, status);
  }
});

telegramHistoryRoutes.post('/:id/search', async (c) => {
  const body = await c.req.json<{ q?: unknown }>().catch(() => null);
  const query = typeof body?.q === 'string' ? body.q.trim() : '';
  if (!query || query.length > SEARCH_MAX_CHARS) return c.json({ error: `informe um texto de 1 a ${SEARCH_MAX_CHARS} caracteres` }, 400);

  const db = await getDb();
  const channel = getTelegramChannel(db, c.req.param('id'));
  if (!channel) return c.json({ error: 'canal não encontrado' }, 404);
  if (!hasHistory(channel.mode)) return c.json({ error: `o modo "${channel.mode}" não tem busca no Telegram (o bot só conhece o que recebeu)` }, 501);
  if (channel.mode === 'personal' && !telegramPersonalEnabled()) return c.json({ error: 'conta pessoal do Telegram não configurada — entre com o QR code em Conexões' }, 501);
  try {
    const outcome = await searchHistory(db, channel, query);
    return outcome.ok ? c.json(outcome.value) : c.json({ error: outcome.error }, outcome.status);
  } catch (err) {
    if (err instanceof TelegramFloodWaitError) return floodWaitResponse(c, err);
    const { error, status } = failure(err);
    return c.json({ error }, status);
  }
});
