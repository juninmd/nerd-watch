import { Api } from 'teleproto';
import { resolvePeer } from './peer.ts';
import { withLiveSession } from './personal.ts';
import type { TelegramChannelInfo } from './public.ts';

export interface PersonalChannelInfoResult extends Omit<TelegramChannelInfo, 'photoUrl'> {
  photo: Uint8Array | null;
}

/** Nome, descrição e foto do canal/grupo pela conta pessoal (funciona também para canais sem prévia pública). */
export const fetchPersonalChannelInfo = (handle: string): Promise<PersonalChannelInfoResult> =>
  withLiveSession(async (client) => {
    const entity = await client.getEntity(await resolvePeer(client, handle));
    const title = entity instanceof Api.Channel || entity instanceof Api.Chat ? entity.title : null;
    let description: string | null = null;
    if (entity instanceof Api.Channel) {
      const full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity })).catch(() => null);
      description = full?.fullChat.about?.trim() || null;
    }
    const photo = await client.downloadProfilePhoto(entity, { isBig: false }).catch(() => undefined);
    return { title, description, photo: photo && typeof photo !== 'string' ? new Uint8Array(photo) : null };
  });

const THUMB_CONCURRENCY = 4;

/**
 * Miniaturas dos vídeos pedidos (id da mensagem → bytes). Só baixa a miniatura embutida; se a mensagem não tiver
 * nenhuma, fica de fora — nunca cai para o download do vídeo inteiro.
 */
export const fetchPersonalThumbs = (handle: string, messageIds: string[]): Promise<Map<string, Uint8Array>> =>
  withLiveSession(async (client) => {
    const thumbs = new Map<string, Uint8Array>();
    if (messageIds.length === 0) return thumbs;
    const messages = await client.getMessages(await resolvePeer(client, handle), { ids: messageIds.map(Number) });
    const wanted: Array<{ msg: Api.Message; best: Api.PhotoSize }> = [];
    for (const msg of messages) {
      if (!msg || !(msg.media instanceof Api.MessageMediaDocument) || !(msg.media.document instanceof Api.Document)) continue;
      const sizes = (msg.media.document.thumbs ?? []).filter((t): t is Api.PhotoSize => t instanceof Api.PhotoSize);
      const best = sizes.sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (best) wanted.push({ msg, best });
    }
    // Medido com 30 vídeos: ~130 ms cada em sequência contra ~0,4 s por lote de 4 depois de aquecido; quem abre o canal espera por isso.
    for (let i = 0; i < wanted.length; i += THUMB_CONCURRENCY) {
      await Promise.all(
        wanted.slice(i, i + THUMB_CONCURRENCY).map(async ({ msg, best }) => {
          const bytes = await client.downloadMedia(msg, { thumb: best }).catch(() => undefined);
          if (bytes && typeof bytes !== 'string') thumbs.set(String(msg.id), new Uint8Array(bytes));
        }),
      );
    }
    return thumbs;
  });
