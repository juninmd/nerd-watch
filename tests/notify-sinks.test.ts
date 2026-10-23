import { describe, expect, test } from 'bun:test';
import { buildSinks } from '../src/server/notify/sinks.ts';
import type { NotifyMessage } from '../src/server/notify/message.ts';

const message: NotifyMessage = {
  kind: 'episode',
  title: 'Série de Teste',
  date: '2026-10-22',
  seasonNumber: 2,
  episodeNumber: 5,
  daysUntil: 0,
  text: 'Série de Teste: T2E5 sai hoje (2026-10-22)',
};

type Call = { url: string; init: RequestInit };

/** fetch falso: registra cada chamada e responde com `status`. */
const recordingFetch = (status = 200) => {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

/** fetch que nunca responde sozinho: só termina quando o sinal de cancelamento dispara. */
const hangingFetch = (): typeof fetch =>
  ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'TimeoutError'));
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener('abort', abort);
    })) as unknown as typeof fetch;

/** Desfaz o RFC 2047 (base64) que o sink usa em headers não-ASCII; devolve o texto como está se não for codificado. */
const decodeHeader = (value: string): string => {
  const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(value);
  return match ? Buffer.from(match[1] ?? '', 'base64').toString('utf8') : value;
};

const WEBHOOK = 'https://hooks.example.test/s3cr3t-token-123';
const NTFY = 'https://ntfy.example.test/topico-privado-456';

describe('buildSinks: configuração', () => {
  test('sem URL nenhuma não existe sink', () => {
    expect(buildSinks({})).toEqual([]);
  });

  test('URL que não é http(s) é descartada (file:, ftp:, javascript:, lixo)', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://x.test/a', 'javascript:alert(1)', 'não-é-url']) {
      expect(buildSinks({ webhookUrl: bad, ntfyUrl: bad })).toEqual([]);
    }
  });

  test('cria um sink por URL válida, na ordem webhook, ntfy', () => {
    const sinks = buildSinks({ webhookUrl: WEBHOOK, ntfyUrl: NTFY, fetchImpl: recordingFetch().fetchImpl });
    expect(sinks.map((s) => s.name)).toEqual(['webhook', 'ntfy']);
  });
});

describe('sink webhook', () => {
  test('faz POST JSON só com título e datas, sem seguir redirecionamento', async () => {
    const { calls, fetchImpl } = recordingFetch(200);
    const [webhook] = buildSinks({ webhookUrl: WEBHOOK, fetchImpl });
    await webhook?.send(message, new AbortController().signal);

    expect(calls).toHaveLength(1);
    const call = calls[0] as Call;
    expect(call.url).toBe(WEBHOOK);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    expect((call.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(call.init.body));
    expect(body).toEqual({
      event: 'release',
      kind: 'episode',
      title: 'Série de Teste',
      date: '2026-10-22',
      season: 2,
      episode: 5,
      daysUntil: 0,
      text: message.text,
    });
  });

  test('status não-2xx é falha (inclusive 3xx, que não é seguido)', async () => {
    const [webhook] = buildSinks({ webhookUrl: WEBHOOK, fetchImpl: recordingFetch(302).fetchImpl });
    await expect(webhook?.send(message, new AbortController().signal)).rejects.toThrow('HTTP 302');
  });

  test('a mensagem de erro não carrega a URL (que tem token)', async () => {
    const [webhook] = buildSinks({ webhookUrl: WEBHOOK, fetchImpl: recordingFetch(500).fetchImpl });
    const error = await webhook?.send(message, new AbortController().signal).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain('s3cr3t-token-123');
  });
});

describe('sink ntfy', () => {
  test('faz POST de texto puro com o título no header Title', async () => {
    const { calls, fetchImpl } = recordingFetch(200);
    const [ntfy] = buildSinks({ ntfyUrl: NTFY, fetchImpl });
    await ntfy?.send(message, new AbortController().signal);

    const call = calls[0] as Call;
    expect(call.url).toBe(NTFY);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    expect(call.init.body).toBe(message.text);
    const title = (call.init.headers as Record<string, string>).Title ?? '';
    expect(decodeHeader(title)).toBe('Lançamento: Série de Teste');
  });

  test('título com caracteres fora do ASCII vai codificado (RFC 2047), sem quebrar o header', async () => {
    const { calls, fetchImpl } = recordingFetch(200);
    const [ntfy] = buildSinks({ ntfyUrl: NTFY, fetchImpl });
    await ntfy?.send({ ...message, title: '進撃の巨人' }, new AbortController().signal);

    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    const header = headers.Title ?? '';
    expect(header).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(decodeHeader(header)).toContain('進撃の巨人');
  });

  test('erro de rede não ecoa a URL do tópico', async () => {
    const failing = (async () => {
      throw new TypeError(`cannot reach ${NTFY}`);
    }) as unknown as typeof fetch;
    const [ntfy] = buildSinks({ ntfyUrl: NTFY, fetchImpl: failing });
    const error = await ntfy?.send(message, new AbortController().signal).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain('topico-privado-456');
  });
});

describe('timeout por sink', () => {
  test('um sink pendurado é cancelado no timeout configurado', async () => {
    const [webhook] = buildSinks({ webhookUrl: WEBHOOK, fetchImpl: hangingFetch(), timeoutMs: 20 });
    const started = Date.now();
    const error = await webhook?.send(message, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('cancelamento externo (stop do scheduler) também aborta o envio', async () => {
    const [webhook] = buildSinks({ webhookUrl: WEBHOOK, fetchImpl: hangingFetch(), timeoutMs: 60_000 });
    const controller = new AbortController();
    const pending = webhook?.send(message, controller.signal).catch((e: unknown) => e);
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
  });
});
