import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { config, telegramPersonalEnabled } from '../../config.ts';
import { updateEnvVar } from '../../env-file.ts';
import { resolvePeer } from './peer.ts';
import { type TelegramPersonalItem, toItem } from './personal-item.ts';
import { withFloodWait } from './flood-wait.ts';

/**
 * Conta pessoal via MTProto (`teleproto`, fork mantido do GramJS): único modo estruturalmente capaz de
 * acessar o histórico completo de um canal (a Bot API não tem `getChatHistory`) e sem o teto de 20MB da
 * Bot API na nuvem. Login é sempre via `bun run telegram:login` (CLI local) — a session string resultante
 * fica só no .env, nunca é aceita por HTTP.
 *
 * Histórico: `fetchPersonalVideoPage` pagina pra trás (`before`) e busca por texto (`query`); o app importa a página mais recente
 * e o usuário carrega as mais antigas sob demanda (`POST /channels/:id/load-more`).
 */
export class TelegramPersonalNotConfiguredError extends Error {
  constructor() {
    super('conta pessoal do Telegram não configurada — rode `bun run telegram:login` e configure TELEGRAM_API_ID/TELEGRAM_API_HASH/TELEGRAM_SESSION no .env');
    this.name = 'TelegramPersonalNotConfiguredError';
  }
}

let clientPromise: Promise<TelegramClient> | null = null;

/** floodSleepThreshold 0: sem isso o teleproto dorme sozinho até 60 s em FLOOD_WAIT, fora do nosso teto e do sleep injetável. */
export const PERSONAL_CLIENT_OPTIONS = { connectionRetries: 5, floodSleepThreshold: 0 } as const;

/** Erros do Telegram que significam "essa session não vale mais" (ex.: encerrada em Ajustes → Dispositivos). */
const DEAD_SESSION_ERRORS = new Set(['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'USER_DEACTIVATED', 'USER_DEACTIVATED_BAN', 'AUTH_KEY_DUPLICATED']);

export const isDeadSessionError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'errorMessage' in err && DEAD_SESSION_ERRORS.has(String(err.errorMessage));

/** Esquece a session morta (memória + .env) pra o app voltar a oferecer o login por QR em vez de ficar "logado" à toa. */
const dropSession = async (): Promise<void> => {
  const pending = clientPromise;
  clientPromise = null;
  config.telegram.session = undefined;
  updateEnvVar('TELEGRAM_SESSION', '');
  await pending?.then((client) => client.disconnect()).catch(() => {});
};

export const withLiveSession = async <T>(fn: (client: TelegramClient) => Promise<T>): Promise<T> => {
  const client = await getClient();
  try {
    return await withFloodWait(() => fn(client));
  } catch (err) {
    if (!isDeadSessionError(err)) throw err;
    await dropSession();
    throw new TelegramPersonalNotConfiguredError();
  }
};

const VERIFY_TIMEOUT_MS = 8_000;

/**
 * Pergunta ao Telegram se a session ainda vale. Só uma rejeição explícita de auth derruba a session —
 * rede fora ou timeout contam como "não sei" e mantêm tudo como está.
 */
export const verifyPersonalSession = async (): Promise<boolean> => {
  if (!telegramPersonalEnabled()) return false;
  try {
    await withLiveSession(async (client) => {
      await Promise.race([client.getMe(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), VERIFY_TIMEOUT_MS))]);
    });
    return true;
  } catch (err) {
    return !(err instanceof TelegramPersonalNotConfiguredError);
  }
};

/**
 * Encerra a session de propósito ("Encerrar sessão" em Conexões): pede ao Telegram o auth.logOut — assim ela
 * também some de Ajustes → Dispositivos — e esquece a session local. O logOut é best-effort: sem rede a
 * session local é descartada do mesmo jeito. Sem session configurada não faz nada (e não toca no .env).
 */
export const logoutPersonalSession = async (): Promise<void> => {
  if (!telegramPersonalEnabled()) return;
  try {
    const client = await getClient();
    await Promise.race([client.invoke(new Api.auth.LogOut()), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), VERIFY_TIMEOUT_MS))]);
  } catch {
    // session já morta ou Telegram inalcançável: o descarte local abaixo é o que importa
  }
  await dropSession();
};

const getClient = async (): Promise<TelegramClient> => {
  if (!telegramPersonalEnabled()) throw new TelegramPersonalNotConfiguredError();
  if (!clientPromise) {
    // biome-ignore lint/style/noNonNullAssertion: telegramPersonalEnabled() já garante os 3 campos presentes
    const client = new TelegramClient(new StringSession(config.telegram.session!), config.telegram.apiId!, config.telegram.apiHash!, PERSONAL_CLIENT_OPTIONS);
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

export type { TelegramPersonalItem } from './personal-item.ts';

/** Máximo que o Telegram devolve por chamada de `getMessages`. */
export const PERSONAL_PAGE_SIZE = 100;

export interface PersonalVideoPage {
  items: TelegramPersonalItem[];
  /** Confirmado: não há mais mensagens antes dessas. */
  exhausted: boolean;
  /** Menor id de mensagem da página (vídeo ou não): é de onde a próxima página continua. */
  oldestId: string | null;
}

/**
 * Uma página de vídeos, do mais recente pro mais antigo. `before` pagina pra trás no histórico e `query` busca no texto
 * da mensagem pelo canal inteiro (no servidor do Telegram), não só no que já foi importado.
 */
export const fetchPersonalVideoPage = async (handle: string, opts: { before?: string; query?: string } = {}): Promise<PersonalVideoPage> => {
  const { messages, confirmedEnd } = await withLiveSession(async (client) => {
    const peer = await resolvePeer(client, handle);
    const filter = new Api.InputMessagesFilterVideo();
    const search = opts.query ? { search: opts.query } : {};
    const page = await client.getMessages(peer, { limit: PERSONAL_PAGE_SIZE, filter, offsetId: opts.before ? Number(opts.before) : 0, ...search });
    if (page.length === 0) return { messages: page, confirmedEnd: true };
    if (page.length === PERSONAL_PAGE_SIZE) return { messages: page, confirmedEnd: false };
    // Página curta não prova o fim (o Telegram pode devolver menos que o pedido): confirma com uma consulta antes da mais antiga.
    // Marcar o fim cedo demais deixaria o resto do histórico inalcançável.
    const probe = await client.getMessages(peer, { limit: 1, filter, offsetId: Math.min(...page.map((m) => m.id)), ...search });
    return { messages: page, confirmedEnd: probe.length === 0 };
  });
  const items: TelegramPersonalItem[] = [];
  for (const msg of messages) {
    const item = toItem(msg);
    if (item) items.push(item);
  }
  const ids = messages.map((m) => m.id);
  return { items, exhausted: confirmedEnd, oldestId: ids.length ? String(Math.min(...ids)) : null };
};

/** Lista vídeos do canal, do mais recente pro mais antigo. `beforeMessageId` pagina pra trás no histórico. */
export const fetchPersonalChannelItems = async (handle: string, beforeMessageId?: string): Promise<TelegramPersonalItem[]> =>
  (await fetchPersonalVideoPage(handle, { before: beforeMessageId })).items;

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

/** Tamanho de cada pedido ao Telegram. Offsets alinhados a ele nunca atravessam a fronteira de 1 MB. */
export const DOWNLOAD_REQUEST_SIZE = 512 * 1024;

export type RangePlan = { start: number; end: number; wantedLength: number; alignedOffset: number; leadingTrim: number; downloadLimit: number };

/**
 * upload.GetFile só responde quando o bloco pedido não atravessa uma fronteira de 1 MB (senão devolve 0 bytes,
 * sem erro): alinha o offset pra baixo ao tamanho do pedido (`DOWNLOAD_REQUEST_SIZE`, divisor de 1 MB) e descarta
 * o excedente no início (`leadingTrim`). `downloadLimit` é quanto pedir ao Telegram (a partir do offset alinhado); `wantedLength`
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
  const alignedOffset = Math.floor(start / DOWNLOAD_REQUEST_SIZE) * DOWNLOAD_REQUEST_SIZE;
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
  const messages = await withLiveSession(async (c) => c.getMessages(await resolvePeer(c, handle), { ids: [Number(messageId)] }));
  const msg = messages[0];
  if (!msg || !(msg.media instanceof Api.MessageMediaDocument) || !(msg.media.document instanceof Api.Document))
    return { ok: false, reason: 'not_found' };
  const doc = msg.media.document;

  const totalSize = Number(doc.size);
  const plan = planRange(range, totalSize);
  if (!plan) return { ok: false, reason: 'range_not_satisfiable', totalSize };

  const generator = client.iterDownload(msg, { offset: plan.alignedOffset, limit: plan.downloadLimit, requestSize: DOWNLOAD_REQUEST_SIZE });

  return { ok: true, data: buildPersonalStream(generator, plan, doc.mimeType || 'video/mp4', totalSize) };
};

export { telegramPersonalEnabled };
