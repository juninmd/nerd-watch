import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { config, telegramPersonalEnabled } from '../../config.ts';

/**
 * Conta pessoal via MTProto (`teleproto`, fork mantido do GramJS): única forma de acessar o histórico
 * completo de um canal (a Bot API não tem `getChatHistory`) e sem o teto de 20MB da Bot API na nuvem.
 * Login é sempre via `bun run telegram:login` (CLI local) — a session string resultante fica só no .env,
 * nunca é aceita por HTTP.
 */
export class TelegramPersonalNotConfiguredError extends Error {
  constructor() {
    super('conta pessoal do Telegram não configurada — rode `bun run telegram:login` e configure TELEGRAM_API_ID/TELEGRAM_API_HASH/TELEGRAM_SESSION no .env');
    this.name = 'TelegramPersonalNotConfiguredError';
  }
}

let clientPromise: Promise<TelegramClient> | null = null;

const getClient = async (): Promise<TelegramClient> => {
  if (!telegramPersonalEnabled()) throw new TelegramPersonalNotConfiguredError();
  if (!clientPromise) {
    // biome-ignore lint/style/noNonNullAssertion: telegramPersonalEnabled() já garante os 3 campos presentes
    const client = new TelegramClient(new StringSession(config.telegram.session!), config.telegram.apiId!, config.telegram.apiHash!, {
      connectionRetries: 5,
    });
    clientPromise = client.connect().then(
      () => client,
      (err) => {
        clientPromise = null; // permite retry numa próxima chamada em vez de travar pra sempre num erro transitório
        throw err;
      },
    );
  }
  return clientPromise;
};

export interface TelegramPersonalItem {
  messageId: string;
  caption: string | null;
  durationSeconds: number | null;
  postedAt: string | null;
}

const toItem = (msg: Api.Message): TelegramPersonalItem | null => {
  if (!(msg.media instanceof Api.MessageMediaDocument) || !(msg.media.document instanceof Api.Document)) return null;
  const doc = msg.media.document;
  const isVideo = doc.mimeType?.startsWith('video/') || doc.attributes.some((a) => a instanceof Api.DocumentAttributeVideo);
  if (!isVideo) return null;
  const videoAttr = doc.attributes.find((a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo);
  return {
    messageId: String(msg.id),
    caption: msg.message || null,
    durationSeconds: videoAttr ? Math.round(videoAttr.duration) : null,
    postedAt: new Date(msg.date * 1000).toISOString(),
  };
};

/** Lista vídeos do canal, do mais recente pro mais antigo. `beforeMessageId` pagina pra trás no histórico. */
export const fetchPersonalChannelItems = async (handle: string, beforeMessageId?: string): Promise<TelegramPersonalItem[]> => {
  const client = await getClient();
  const messages = await client.getMessages(handle, {
    limit: 30,
    filter: new Api.InputMessagesFilterVideo(),
    offsetId: beforeMessageId ? Number(beforeMessageId) : 0,
  });
  const items: TelegramPersonalItem[] = [];
  for (const msg of messages) {
    const item = toItem(msg);
    if (item) items.push(item);
  }
  return items;
};

export interface PersonalStream {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  totalSize: number;
  start: number;
  end: number;
}

/**
 * Descarta `leadingTrim` bytes do início do primeiro(s) chunk(s) e corta no total de `wantedLength` bytes —
 * necessário porque o offset pedido pro Telegram é alinhado a 4096 (`streamPersonalItem`) e pode vir "antes"
 * do byte que o Range do cliente pediu de fato.
 */
export const trimChunkStream = (
  generator: AsyncGenerator<Buffer, void, unknown>,
  leadingTrim: number,
  wantedLength: number,
): ReadableStream<Uint8Array> => {
  let skip = leadingTrim;
  let remaining = wantedLength;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Um chunk pode ser todo descartado pelo `skip` (sobra vazia) — precisa continuar puxando do generator
      // até realmente enfileirar algo ou fechar, senão o pull() resolve sem enfileirar e a stream trava.
      for (;;) {
        const { value, done } = await generator.next();
        if (done || remaining <= 0) {
          controller.close();
          return;
        }
        let chunk: Uint8Array = value;
        if (skip > 0) {
          const drop = Math.min(skip, chunk.length);
          chunk = chunk.subarray(drop);
          skip -= drop;
        }
        if (chunk.length > remaining) chunk = chunk.subarray(0, remaining);
        remaining -= chunk.length;
        if (chunk.length > 0) {
          controller.enqueue(chunk);
          if (remaining <= 0) controller.close();
          return;
        }
        if (remaining <= 0) {
          controller.close();
          return;
        }
      }
    },
    async cancel() {
      await generator.return(undefined);
    },
  });
};

/** Baixa em stream (chunk a chunk, sem bufferizar o arquivo inteiro) o trecho `[start, end]` do vídeo. */
export const streamPersonalItem = async (
  handle: string,
  messageId: string,
  range: { start: number; end: number | null },
): Promise<PersonalStream | null> => {
  const client = await getClient();
  const messages = await client.getMessages(handle, { ids: [Number(messageId)] });
  const msg = messages[0];
  if (!msg || !(msg.media instanceof Api.MessageMediaDocument) || !(msg.media.document instanceof Api.Document)) return null;
  const doc = msg.media.document;

  const totalSize = Number(doc.size);
  const start = Math.max(0, range.start);
  const end = Math.min(range.end ?? totalSize - 1, totalSize - 1);
  const wantedLength = end - start + 1;

  // upload.GetFile exige offset múltiplo de 4096: alinha pra baixo e descarta o excedente no início.
  const alignedOffset = Math.floor(start / 4096) * 4096;
  const leadingTrim = start - alignedOffset;
  const generator = client.iterDownload(msg, { offset: alignedOffset, limit: leadingTrim + wantedLength });

  return {
    stream: trimChunkStream(generator, leadingTrim, leadingTrim + wantedLength),
    contentType: doc.mimeType || 'video/mp4',
    totalSize,
    start,
    end,
  };
};

export { telegramPersonalEnabled };
