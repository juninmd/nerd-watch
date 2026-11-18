import { Api } from 'teleproto';
import type { ChannelPin, ChannelTopic } from '../../repo/telegram-topics.ts';
import { resolvePeer } from './peer.ts';
import { withLiveSession } from './personal.ts';

const TOPIC_LIMIT = 100;
const PIN_LIMIT = 50;

/** Teto do texto guardado de uma fixada: só serve de rótulo na barra lateral. */
const PIN_TEXT_MAX = 300;

/**
 * Tópicos do fórum e mensagens fixadas do canal. Canal sem fórum rejeita `GetForumTopics` (CHANNEL_FORUM_MISSING):
 * isso não é erro, só significa "sem tópicos". Fixadas valem para qualquer canal ou grupo.
 */
export const fetchPersonalChannelMeta = async (handle: string): Promise<{ topics: ChannelTopic[]; pins: ChannelPin[] }> =>
  withLiveSession(async (client) => {
    const peer = await resolvePeer(client, handle);
    const topics: ChannelTopic[] = [];
    try {
      const res = await client.invoke(new Api.messages.GetForumTopics({ peer, offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: TOPIC_LIMIT }));
      if (res instanceof Api.messages.ForumTopics) {
        for (const t of res.topics) if (t instanceof Api.ForumTopic) topics.push({ topicId: String(t.id), title: t.title, pinned: t.pinned === true });
      }
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'errorMessage' in err ? String(err.errorMessage) : '';
      if (!code.startsWith('CHANNEL_FORUM_MISSING') && !code.startsWith('PEER_ID_INVALID') && !code.startsWith('CHAT_ID_INVALID')) throw err;
    }
    const found = await client.getMessages(peer, { limit: PIN_LIMIT, filter: new Api.InputMessagesFilterPinned() });
    const pins: ChannelPin[] = found.map((m) => ({
      messageId: String(m.id),
      text: m.message ? m.message.slice(0, PIN_TEXT_MAX) : null,
      postedAt: m.date ? new Date(m.date * 1000).toISOString() : null,
    }));
    return { topics, pins };
  });
