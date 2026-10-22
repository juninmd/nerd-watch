import { Api } from 'teleproto';
import { privateChannelId } from './ref.ts';

export class PrivateChannelNotFoundError extends Error {
  constructor() {
    super('a conta pessoal não participa desse canal ou grupo privado — entre nele no Telegram e tente de novo');
    this.name = 'PrivateChannelNotFoundError';
  }
}

/** O mínimo do `TelegramClient` que a varredura usa (permite testar sem MTProto). */
interface DialogScanner {
  iterDialogs(opts: { folder?: number; limit?: number }): AsyncIterable<{ entity?: unknown; inputEntity: Api.TypeInputPeer }>;
}

/** Teto de diálogos olhados por pasta: contas enormes não viram uma varredura sem fim. */
const MAX_SCAN = 3000;
/** 0 = lista principal, 1 = arquivados. */
const FOLDERS = [0, 1];

// Por conexão: a sessão do `teleproto` só guarda os access hashes em memória, então nada sobrevive a um reinício.
const resolved = new WeakMap<object, Map<string, Api.TypeInputPeer>>();

/**
 * Canal ou grupo privado não tem @usuário: o Telegram só o endereça pelo id + access hash, e o hash só chega
 * pela lista de conversas de quem participa. Para handle público devolve o próprio texto (o cliente resolve);
 * para `c/<id>` varre os diálogos e devolve o `InputPeer`, ou `PrivateChannelNotFoundError` se a conta não está lá.
 */
export const resolvePeer = async (client: DialogScanner, handle: string): Promise<string | Api.TypeInputPeer> => {
  const channelId = privateChannelId(handle);
  if (channelId === null) return handle;

  const cache = resolved.get(client) ?? new Map<string, Api.TypeInputPeer>();
  resolved.set(client, cache);
  const known = cache.get(channelId);
  if (known) return known;

  for (const folder of FOLDERS) {
    for await (const dialog of client.iterDialogs({ folder, limit: MAX_SCAN })) {
      // `Channel` cobre canal de transmissão e supergrupo; conversa direta com o mesmo número é `User` e não casa.
      if (dialog.entity instanceof Api.Channel && String(dialog.entity.id) === channelId) {
        cache.set(channelId, dialog.inputEntity);
        return dialog.inputEntity;
      }
    }
  }
  throw new PrivateChannelNotFoundError();
};
