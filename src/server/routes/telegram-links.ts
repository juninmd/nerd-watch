import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { getDb } from '../db.ts';
import type { LinkCandidate } from '../media-name/match.ts';
import { getTelegramChannel, getTelegramItem } from '../repo/telegram.ts';
import {
  acceptChannelSuggestions,
  itemLinkFromRow,
  listLinkCandidates,
  type ManualLink,
  refreshChannelLinks,
  setItemLink,
} from '../repo/telegram-links.ts';

/** Vínculo vídeo ↔ episódio: montado em `/channels` pelo roteador do Telegram. */
export const telegramLinkRoutes = new Hono();

const MAX_SPAN = 100;
const isSeason = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999;
const isEpisode = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 9999;

interface LinkBody {
  titleId?: unknown;
  seasonNumber?: unknown;
  episodeNumber?: unknown;
  episodeEnd?: unknown;
}

/** Valida o corpo contra a biblioteca: o título tem de estar nela como série e o(s) episódio(s) conhecidos. */
export const parseManualLink = (body: LinkBody | null, candidates: LinkCandidate[]): ManualLink | string => {
  if (!body || typeof body.titleId !== 'string' || body.titleId.length === 0 || body.titleId.length > 100)
    return 'titleId obrigatório';
  if (!isSeason(body.seasonNumber)) return 'seasonNumber deve ser inteiro entre 0 e 999';
  if (!isEpisode(body.episodeNumber)) return 'episodeNumber deve ser inteiro entre 1 e 9999';
  const end = body.episodeEnd ?? null;
  if (end !== null && (!isEpisode(end) || end < body.episodeNumber || end - body.episodeNumber > MAX_SPAN)) {
    return `episodeEnd deve ser inteiro maior ou igual a episodeNumber e no máximo ${MAX_SPAN} episódios depois`;
  }
  const candidate = candidates.find((c) => c.titleId === body.titleId);
  if (!candidate) return 'título não está na biblioteca como série';
  const last = typeof end === 'number' ? end : body.episodeNumber;
  for (let e = body.episodeNumber; e <= last; e++) {
    if (!candidate.episodes.some((x) => x.season === body.seasonNumber && x.episode === e))
      return 'episódio não encontrado na biblioteca; abra a temporada antes de vincular';
  }
  return {
    titleId: body.titleId,
    seasonNumber: body.seasonNumber,
    episodeNumber: body.episodeNumber,
    episodeEnd: typeof end === 'number' ? end : undefined,
  };
};

const channelOr404 = (db: Database, id: string) => getTelegramChannel(db, id);

telegramLinkRoutes.post('/:id/items/:messageId/link', async (c) => {
  const db = await getDb();
  if (!channelOr404(db, c.req.param('id'))) return c.json({ error: 'canal não encontrado' }, 404);
  const parsed = parseManualLink(await c.req.json<LinkBody>().catch(() => null), listLinkCandidates(db));
  if (typeof parsed === 'string') return c.json({ error: parsed }, 400);
  if (!setItemLink(db, c.req.param('id'), c.req.param('messageId'), parsed))
    return c.json({ error: 'vídeo não encontrado nesse canal' }, 404);
  const row = getTelegramItem(db, c.req.param('id'), c.req.param('messageId'));
  return c.json({ link: row ? itemLinkFromRow(row) : null });
});

telegramLinkRoutes.delete('/:id/items/:messageId/link', async (c) => {
  const db = await getDb();
  if (!channelOr404(db, c.req.param('id'))) return c.json({ error: 'canal não encontrado' }, 404);
  // "Sem vínculo" fica registrado como decisão manual: o automático não volta a sugerir esse vídeo.
  if (!setItemLink(db, c.req.param('id'), c.req.param('messageId'), null))
    return c.json({ error: 'vídeo não encontrado nesse canal' }, 404);
  return c.json({ link: null });
});

telegramLinkRoutes.post('/:id/links/refresh', async (c) => {
  const db = await getDb();
  if (!channelOr404(db, c.req.param('id'))) return c.json({ error: 'canal não encontrado' }, 404);
  return c.json(refreshChannelLinks(db, c.req.param('id')));
});

telegramLinkRoutes.post('/:id/links/accept-suggestions', async (c) => {
  const db = await getDb();
  if (!channelOr404(db, c.req.param('id'))) return c.json({ error: 'canal não encontrado' }, 404);
  return c.json({ accepted: acceptChannelSuggestions(db, c.req.param('id')) });
});
