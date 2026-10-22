import { Api } from 'teleproto';
import { withLiveSession } from './personal.ts';
import { privateHandle } from './ref.ts';

export interface PersonalChannelInfo {
  title: string;
  /** `usuario` quando o canal é público; `c/<id>` quando é privado (ver `ref.ts`). */
  handle: string;
  members: number | null;
  kind: 'channel' | 'group';
}

interface DialogLike {
  isChannel: boolean;
  isGroup: boolean;
  title?: string;
  entity?: unknown;
}

/**
 * Canais de transmissão e supergrupos em que a conta participa. Conversas diretas e grupos antigos (`Chat`,
 * sem id de canal e sem link `t.me/c/`) ficam de fora.
 */
export const channelInfoFromDialog = (d: DialogLike): PersonalChannelInfo | null => {
  if (!d.isChannel || !(d.entity instanceof Api.Channel)) return null;
  const ch = d.entity;
  const handle = ch.username ?? ch.usernames?.find((u) => u.active)?.username ?? privateHandle(String(ch.id));
  return { title: d.title || ch.title, handle, members: ch.participantsCount ?? null, kind: d.isGroup ? 'group' : 'channel' };
};

const MAX_DIALOGS = 500;

/** Canais e grupos em que a conta pessoal participa, na ordem do chat list (mais recentes primeiro). */
export const listPersonalChannels = async (): Promise<PersonalChannelInfo[]> => {
  const dialogs = await withLiveSession((client) => client.getDialogs({ limit: MAX_DIALOGS }));
  return dialogs.flatMap((d) => channelInfoFromDialog(d) ?? []);
};
