import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { runNotifyTick, type NotifyTickDeps } from '../src/server/notify/tick.ts';
import { type CalendarEntry, listUpcoming } from '../src/server/repo/calendar.ts';
import { notificationKey } from '../src/server/notify/due.ts';
import { buildSinks } from '../src/server/notify/sinks.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { sentKeys } from '../src/server/repo/notifications.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

const WEBHOOK = 'https://hooks.example.test/s3cr3t-token-123';
const NTFY = 'https://ntfy.example.test/topico-privado-456';
/** Dia do lançamento, em hora local (como o app calcula "hoje"). */
const NOW = new Date(2026, 9, 22, 10, 0);
const AIR_DATE = '2026-10-22';
let KEY = '';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
  const title = upsertTitle(db, { source: 'tvmaze', sourceId: '1', mediaType: 'tv', title: 'Série de Teste' });
  upsertLibraryEntry(db, title.id, { watchStatus: 'watching' });
  const season = upsertSeason(db, title.id, { seasonNumber: 2, name: 'T2' });
  replaceEpisodes(db, season.id, [{ episodeNumber: 5, name: 'Ep 5', airDate: AIR_DATE }]);
  // A chave usa o id gerado do título: derivamos do próprio dado em vez de chumbar um valor.
  KEY = notificationKey(listUpcoming(db, 0, AIR_DATE)[0] as CalendarEntry);
});

type Responder = (url: string, init: RequestInit) => Promise<Response> | Response;

/** fetch falso que decide a resposta pela URL e registra cada chamada. */
const fakeFetch = (respond: Responder) => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return respond(url, init ?? {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

const ok = () => new Response(null, { status: 200 });
const fail = () => new Response(null, { status: 500 });
/** Pendura até o sinal de cancelamento disparar, como um servidor que não responde. */
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const abort = () => reject(new DOMException('aborted', 'TimeoutError'));
    if (init.signal?.aborted) return abort();
    init.signal?.addEventListener('abort', abort);
  });

const makeDeps = (fetchImpl: typeof fetch, extra: Partial<NotifyTickDeps> = {}): NotifyTickDeps & { lines: string[] } => {
  const lines: string[] = [];
  return {
    db,
    sinks: buildSinks({ webhookUrl: WEBHOOK, ntfyUrl: NTFY, fetchImpl, timeoutMs: 50 }),
    leadDays: 0,
    now: () => NOW,
    attempts: new Map(),
    maxAttempts: 3,
    log: (line) => lines.push(line),
    lines,
    ...extra,
  };
};

const isWebhook = (url: string) => url === WEBHOOK;

describe('runNotifyTick: entrega', () => {
  test('sucesso em todos os sinks: notifica uma vez e marca como enviado', async () => {
    const { calls, fetchImpl } = fakeFetch(ok);
    const result = await runNotifyTick(makeDeps(fetchImpl));

    expect(result).toEqual({ notified: 1, failed: 0 });
    expect(calls.filter(isWebhook)).toHaveLength(1);
    expect(calls).toContain(NTFY);
    expect([...sentKeys(db, [KEY])]).toEqual([KEY]);
  });

  test('reiniciar o processo não renotifica: a marcação vem do banco', async () => {
    await runNotifyTick(makeDeps(fakeFetch(ok).fetchImpl));

    const second = fakeFetch(ok);
    const result = await runNotifyTick(makeDeps(second.fetchImpl));
    expect(result).toEqual({ notified: 0, failed: 0 });
    expect(second.calls).toEqual([]);
  });

  test('sem nenhum sink não envia nada e não marca nada', async () => {
    const { calls, fetchImpl } = fakeFetch(ok);
    const result = await runNotifyTick(makeDeps(fetchImpl, { sinks: [] }));

    expect(result).toEqual({ notified: 0, failed: 0 });
    expect(calls).toEqual([]);
    expect(sentKeys(db, [KEY]).size).toBe(0);
  });

  test('biblioteca sem lançamento na janela: nada a fazer', async () => {
    const { calls, fetchImpl } = fakeFetch(ok);
    const result = await runNotifyTick(makeDeps(fetchImpl, { now: () => new Date(2026, 8, 1, 10, 0) }));
    expect(result).toEqual({ notified: 0, failed: 0 });
    expect(calls).toEqual([]);
  });
});

describe('runNotifyTick: falhas por sink', () => {
  test('um sink falhando não bloqueia o outro, e o aviso conta como enviado', async () => {
    const { calls, fetchImpl } = fakeFetch((url) => (isWebhook(url) ? fail() : ok()));
    const deps = makeDeps(fetchImpl);
    const result = await runNotifyTick(deps);

    expect(result).toEqual({ notified: 1, failed: 0 });
    expect(calls).toContain(NTFY);
    expect([...sentKeys(db, [KEY])]).toEqual([KEY]);
  });

  test('log mostra o host do sink que falhou, nunca a URL completa nem o token', async () => {
    const { fetchImpl } = fakeFetch((url) => (isWebhook(url) ? fail() : ok()));
    const deps = makeDeps(fetchImpl);
    await runNotifyTick(deps);

    const output = deps.lines.join('\n');
    expect(output).toContain('hooks.example.test');
    expect(output).not.toContain('s3cr3t-token-123');
    expect(output).not.toContain(WEBHOOK);
  });

  test('todos falhando: não marca como enviado e tenta de novo no próximo tick', async () => {
    const { calls, fetchImpl } = fakeFetch(fail);
    const deps = makeDeps(fetchImpl);

    expect(await runNotifyTick(deps)).toEqual({ notified: 0, failed: 1 });
    expect(sentKeys(db, [KEY]).size).toBe(0);

    const callsAfterFirst = calls.length;
    expect(await runNotifyTick(deps)).toEqual({ notified: 0, failed: 1 });
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });

  test('retry é limitado: depois de maxAttempts para de tentar nesta execução', async () => {
    const { calls, fetchImpl } = fakeFetch(fail);
    const deps = makeDeps(fetchImpl, { maxAttempts: 2 });

    await runNotifyTick(deps);
    await runNotifyTick(deps);
    const settled = calls.length;
    const third = await runNotifyTick(deps);

    expect(calls.length).toBe(settled);
    expect(third).toEqual({ notified: 0, failed: 0 });
    expect(sentKeys(db, [KEY]).size).toBe(0);
  });
});

describe('runNotifyTick: timeout', () => {
  test('sink pendurado é cancelado e o outro sink entrega mesmo assim', async () => {
    const { fetchImpl } = fakeFetch((url, init) => (isWebhook(url) ? hang(url, init) : ok()));
    const started = Date.now();
    const result = await runNotifyTick(makeDeps(fetchImpl));

    expect(result).toEqual({ notified: 1, failed: 0 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect([...sentKeys(db, [KEY])]).toEqual([KEY]);
  });

  test('stop do scheduler aborta envios em andamento', async () => {
    const { fetchImpl } = fakeFetch(hang);
    const controller = new AbortController();
    const pending = runNotifyTick(makeDeps(fetchImpl, { signal: controller.signal }));
    controller.abort();
    expect(await pending).toEqual({ notified: 0, failed: 1 });
    expect(sentKeys(db, [KEY]).size).toBe(0);
  });
});
