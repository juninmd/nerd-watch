import type { NotifyMessage } from './message.ts';
import { parseHttpUrl } from './url.ts';

export interface NotifySink {
  readonly name: 'webhook' | 'ntfy';
  /** Resolve se o destino aceitou; rejeita com `SinkError` (mensagem sem URL, só o host). */
  send(message: NotifyMessage, signal: AbortSignal): Promise<void>;
}

export interface SinkOptions {
  webhookUrl?: string;
  ntfyUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const SINK_TIMEOUT_MS = 8_000;
/** ntfy aceita o título em UTF-8 só via RFC 2047; limitamos o tamanho para caber numa palavra codificada. */
const NTFY_TITLE_MAX = 60;

/** Erro de entrega. Carrega o host, nunca a URL: ela pode levar um token na query ou no caminho. */
export class SinkError extends Error {
  constructor(sink: string, host: string, reason: string) {
    super(`${sink} (${host}): ${reason}`);
    this.name = 'SinkError';
  }
}

/** Monta só os sinks cuja URL foi configurada e é http(s). Ordem fixa: webhook, depois ntfy. */
export const buildSinks = (options: SinkOptions): NotifySink[] => {
  const fetchImpl: typeof fetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SINK_TIMEOUT_MS;
  const sinks: NotifySink[] = [];

  const webhookUrl = parseHttpUrl(options.webhookUrl);
  if (webhookUrl) {
    sinks.push({
      name: 'webhook',
      send: (message, signal) =>
        deliver('webhook', webhookUrl, fetchImpl, timeoutMs, signal, {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'release',
            kind: message.kind,
            title: message.title,
            date: message.date,
            season: message.seasonNumber,
            episode: message.episodeNumber,
            daysUntil: message.daysUntil,
            text: message.text,
          }),
        }),
    });
  }

  const ntfyUrl = parseHttpUrl(options.ntfyUrl);
  if (ntfyUrl) {
    sinks.push({
      name: 'ntfy',
      send: (message, signal) =>
        deliver('ntfy', ntfyUrl, fetchImpl, timeoutMs, signal, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            Title: encodeHeader(Array.from(`Lançamento: ${message.title}`).slice(0, NTFY_TITLE_MAX).join('')),
          },
          body: message.text,
        }),
    });
  }

  return sinks;
};

/**
 * POST com timeout próprio e cancelamento externo. `redirect: 'error'` impede seguir redirecionamento para outro
 * host (o token na URL iria junto). Qualquer status não-2xx é falha.
 */
const deliver = async (
  sink: string,
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  outer: AbortSignal,
  init: { headers: Record<string, string>; body: string },
): Promise<void> => {
  const host = new URL(url).host;
  // setTimeout (e não AbortSignal.timeout) para limpar o timer ao terminar: um timer de 8 s por envio que sobra
  // vivo depois do fim segura o processo e acumula sem necessidade.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = AbortSignal.any([timeout.signal, outer]);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal, ...init });
  } catch {
    // O erro original pode trazer a URL na mensagem: descartamos e falamos só a causa.
    if (outer.aborted) throw new SinkError(sink, host, 'cancelado');
    if (timeout.signal.aborted) throw new SinkError(sink, host, `sem resposta em ${timeoutMs} ms`);
    throw new SinkError(sink, host, 'falha de rede');
  } finally {
    clearTimeout(timer);
  }
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new SinkError(sink, host, `HTTP ${response.status}`);
};

/** Header só aceita ASCII imprimível; o resto vai como palavra RFC 2047 em base64. Quebras de linha somem. */
const encodeHeader = (value: string): string => {
  const clean = value.replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
};
