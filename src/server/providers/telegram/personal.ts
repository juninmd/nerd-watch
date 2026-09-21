import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { config, telegramPersonalEnabled } from '../../config.ts';

/**
 * Conta pessoal via MTProto (`teleproto`, fork mantido do GramJS): único modo estruturalmente capaz de
 * acessar o histórico completo de um canal (a Bot API não tem `getChatHistory`) e sem o teto de 20MB da
 * Bot API na nuvem. Login é sempre via `bun run telegram:login` (CLI local) — a session string resultante
 * fica só no .env, nunca é aceita por HTTP.
 *
 * LIMITAÇÃO ATUAL: só a 1ª página (30 mensagens mais recentes) é importada — `beforeMessageId` existe
 * pra paginar pra trás mas nada ainda chama com esse argumento, e `telegram_channels.cursor` é gravado
 * mas nunca lido de volta. "Histórico completo" hoje é uma capacidade do protocolo, não algo entregue
 * pela UI/rotas atuais.
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

export type PersonalStreamResolution =
  | { ok: true; data: PersonalStream }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'range_not_satisfiable'; totalSize: number };

export type RangePlan = { start: number; end: number; wantedLength: number; alignedOffset: number; leadingTrim: number; downloadLimit: number };

/**
 * upload.GetFile exige offset múltiplo de 4096: alinha pra baixo e descarta o excedente no início
 * (`leadingTrim`). `downloadLimit` é quanto pedir ao Telegram (a partir do offset alinhado); `wantedLength`
 * é quanto efetivamente devolver ao cliente depois de descartar `leadingTrim` — são valores DIFERENTES,
 * e passar `downloadLimit` onde `trimChunkStream` espera `wantedLength` faz a resposta vazar até
 * `leadingTrim` bytes a mais do que o `Content-Length` declarado (corrompe o corpo em qualquer seek
 * não alinhado a 4096, que é basicamente todo scrub do player).
 */
export const planRange = (range: { start: number; end: number | null }, totalSize: number): RangePlan | null => {
  const start = Math.max(0, range.start);
  if (start > totalSize - 1) return null;
  const end = Math.min(range.end ?? totalSize - 1, totalSize - 1);
  // Range invertido (ex.: `bytes=500-100`) passa pela regex da rota mas não é satisfazível — sem essa
  // guarda, wantedLength dava negativo e a resposta saía 206 com Content-Length negativo/Content-Range inválido.
  if (end < start) return null;
  const wantedLength = end - start + 1;
  const alignedOffset = Math.floor(start / 4096) * 4096;
  const leadingTrim = start - alignedOffset;
  return { start, end, wantedLength, alignedOffset, leadingTrim, downloadLimit: leadingTrim + wantedLength };
};

/**
 * Monta o `PersonalStream` a partir de um `RangePlan` já resolvido e do generator de download — extraído de
 * `streamPersonalItem` pra ser testável sem mockar `TelegramClient`/MTProto: um teste que chama só
 * `trimChunkStream` diretamente não pega regressão nos argumentos passados aqui (já aconteceu uma vez).
 */
export const buildPersonalStream = (
  generator: AsyncGenerator<Buffer, void, unknown>,
  plan: RangePlan,
  contentType: string,
  totalSize: number,
): PersonalStream => ({
  stream: trimChunkStream(generator, plan.leadingTrim, plan.wantedLength),
  contentType,
  totalSize,
  start: plan.start,
  end: plan.end,
});

/** Baixa em stream (chunk a chunk, sem bufferizar o arquivo inteiro) o trecho `[start, end]` do vídeo. */
export const streamPersonalItem = async (
  handle: string,
  messageId: string,
  range: { start: number; end: number | null },
): Promise<PersonalStreamResolution> => {
  const client = await getClient();
  const messages = await client.getMessages(handle, { ids: [Number(messageId)] });
  const msg = messages[0];
  if (!msg || !(msg.media instanceof Api.MessageMediaDocument) || !(msg.media.document instanceof Api.Document))
    return { ok: false, reason: 'not_found' };
  const doc = msg.media.document;

  const totalSize = Number(doc.size);
  const plan = planRange(range, totalSize);
  if (!plan) return { ok: false, reason: 'range_not_satisfiable', totalSize };

  const generator = client.iterDownload(msg, { offset: plan.alignedOffset, limit: plan.downloadLimit });

  return { ok: true, data: buildPersonalStream(generator, plan, doc.mimeType || 'video/mp4', totalSize) };
};

export { telegramPersonalEnabled };
