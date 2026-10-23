import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errors } from 'teleproto';
import { FLOOD_WAIT_MAX_SECONDS, TelegramFloodWaitError, floodWaitResponse, floodWaitSeconds, withFloodWait } from '../src/server/providers/telegram/flood-wait.ts';
import { PERSONAL_CLIENT_OPTIONS } from '../src/server/providers/telegram/personal.ts';

/** Erro como o teleproto entrega na prática: `errorMessage` com o código do fio. */
const wire = (errorMessage: string) => Object.assign(new Error(errorMessage), { errorMessage });

/** Relógio falso: registra as esperas pedidas e não dorme de verdade. */
const fakeSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

/** Função que falha com a sequência de erros dada e depois devolve `value`. Conta as chamadas. */
const scripted = <T>(outcomes: Array<unknown | 'ok'>, value: T) => {
  let calls = 0;
  const fn = async (): Promise<T> => {
    const next = outcomes[calls++];
    if (next === undefined || next === 'ok') return value;
    throw next;
  };
  return { fn, calls: () => calls };
};

describe('floodWaitSeconds', () => {
  test('lê os segundos do erro do teleproto (instância da classe)', () => {
    expect(floodWaitSeconds(new errors.FloodWaitError({ capture: '42', request: undefined } as never))).toBe(42);
  });

  test('lê FLOOD_WAIT_x e FLOOD_PREMIUM_WAIT_x do código do fio', () => {
    expect(floodWaitSeconds(wire('FLOOD_WAIT_17'))).toBe(17);
    expect(floodWaitSeconds(wire('FLOOD_PREMIUM_WAIT_5'))).toBe(5);
  });

  test('erro que não é flood wait devolve null, inclusive sufixo malformado e valor não-objeto', () => {
    expect(floodWaitSeconds(wire('AUTH_KEY_UNREGISTERED'))).toBeNull();
    expect(floodWaitSeconds(wire('FLOOD_WAIT_x'))).toBeNull();
    expect(floodWaitSeconds(wire('PEER_FLOOD'))).toBeNull();
    expect(floodWaitSeconds(new Error('timeout'))).toBeNull();
    expect(floodWaitSeconds('FLOOD_WAIT_3')).toBeNull();
    expect(floodWaitSeconds(undefined)).toBeNull();
  });
});

describe('withFloodWait', () => {
  test('sem erro: devolve o valor de uma vez, sem esperar', async () => {
    const { waits, sleep } = fakeSleep();
    const f = scripted([], 'pronto');
    expect(await withFloodWait(f.fn, { sleep })).toBe('pronto');
    expect(f.calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('espera curta (dentro do teto): espera o tempo pedido e tenta uma vez de novo', async () => {
    const { waits, sleep } = fakeSleep();
    const f = scripted([wire('FLOOD_WAIT_5')], 'ok-depois');
    expect(await withFloodWait(f.fn, { sleep })).toBe('ok-depois');
    expect(waits).toEqual([5_000]);
    expect(f.calls()).toBe(2);
  });

  test('espera acima do teto: não dorme, devolve erro com o tempo para tentar de novo', async () => {
    const { waits, sleep } = fakeSleep();
    const f = scripted([wire(`FLOOD_WAIT_${FLOOD_WAIT_MAX_SECONDS + 1}`)], 'nunca');
    const err = await withFloodWait(f.fn, { sleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramFloodWaitError);
    expect((err as TelegramFloodWaitError).retryAfterSeconds).toBe(FLOOD_WAIT_MAX_SECONDS + 1);
    expect(waits).toEqual([]);
    expect(f.calls()).toBe(1);
  });

  test('o teto é configurável: mesma espera passa com teto maior e falha com teto menor', async () => {
    const { waits, sleep } = fakeSleep();
    expect(await withFloodWait(scripted([wire('FLOOD_WAIT_20')], 'ok').fn, { sleep, maxWaitSeconds: 25 })).toBe('ok');
    expect(waits).toEqual([20_000]);
    await expect(withFloodWait(scripted([wire('FLOOD_WAIT_20')], 'ok').fn, { sleep, maxWaitSeconds: 10 })).rejects.toBeInstanceOf(TelegramFloodWaitError);
  });

  test('segundo flood wait depois da espera curta: desiste (sem laço) e devolve o novo tempo', async () => {
    const { waits, sleep } = fakeSleep();
    const f = scripted([wire('FLOOD_WAIT_3'), wire('FLOOD_WAIT_9')], 'nunca');
    const err = await withFloodWait(f.fn, { sleep }).catch((e: unknown) => e);
    expect((err as TelegramFloodWaitError).retryAfterSeconds).toBe(9);
    expect(waits).toEqual([3_000]);
    expect(f.calls()).toBe(2);
  });

  test('flood wait que nunca passa: no máximo duas chamadas e uma espera, nunca mais', async () => {
    const { waits, sleep } = fakeSleep();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw wire('FLOOD_WAIT_1');
    };
    await expect(withFloodWait(fn, { sleep })).rejects.toBeInstanceOf(TelegramFloodWaitError);
    expect(calls).toBe(2);
    expect(waits).toEqual([1_000]);
  });

  test('erro que não é flood wait passa intacto, sem nova tentativa', async () => {
    const { waits, sleep } = fakeSleep();
    const boom = wire('AUTH_KEY_UNREGISTERED');
    const f = scripted([boom], 'nunca');
    await expect(withFloodWait(f.fn, { sleep })).rejects.toBe(boom);
    expect(f.calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('erro não-flood na segunda tentativa também sai intacto', async () => {
    const { sleep } = fakeSleep();
    const boom = new Error('rede caiu');
    const f = scripted([wire('FLOOD_WAIT_2'), boom], 'nunca');
    await expect(withFloodWait(f.fn, { sleep })).rejects.toBe(boom);
  });
});

describe('resposta HTTP do flood wait', () => {
  test('429 com Retry-After em segundos e mensagem em português', async () => {
    const app = new Hono();
    app.get('/x', (c) => floodWaitResponse(c, new TelegramFloodWaitError(90)));
    const res = await app.request('/x');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(((await res.json()) as { error: string }).error).toContain('90 s');
  });
});

describe('cliente pessoal', () => {
  test('o teleproto não dorme sozinho em flood wait: quem decide é withFloodWait', () => {
    expect(PERSONAL_CLIENT_OPTIONS.floodSleepThreshold).toBe(0);
    expect(PERSONAL_CLIENT_OPTIONS.connectionRetries).toBe(5);
  });
});
