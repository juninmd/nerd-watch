import { describe, expect, test } from 'bun:test';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, describeError, newBackoff, runRefreshTick, startRefreshJob, type TickDeps } from '../src/server/metadata/refresh-job.ts';
import { TmdbRequestError } from '../src/server/providers/tmdb.ts';
import type { TitleRow } from '../src/server/types.ts';

const MIN = 60_000;
const T0 = new Date('2026-10-22T12:00:00.000Z');

/** Série que precisa de refresh (nunca atualizada): é a candidata padrão dos testes de tick. */
const due = (id: string): TitleRow => ({
  id,
  source: 'tmdb',
  source_id: id,
  media_type: 'tv',
  title: `Série ${id}`,
  original_title: null,
  overview: null,
  poster_path: null,
  backdrop_path: null,
  release_date: '2020-01-01',
  vote_average: null,
  created_at: T0.toISOString(),
  metadata_status: 'Returning Series',
  metadata_refreshed_at: null,
  genres: '[]',
  runtime_minutes: null,
});

/** Relógio controlável: `clock.ms` é o "agora" do tick. */
const makeClock = (start = T0.getTime()) => {
  const clock = { ms: start };
  return { clock, now: () => new Date(clock.ms) };
};

const makeDeps = (titles: TitleRow[], refresh: TickDeps['refresh'], maxPerTick = 2, now = makeClock().now) => ({
  listCandidates: () => titles,
  refresh,
  now,
  maxPerTick,
  log: () => {},
});

describe('runRefreshTick: limite por tick', () => {
  test('atualiza no máximo maxPerTick títulos, sequencialmente, na ordem recebida', async () => {
    const titles = [due('1'), due('2'), due('3'), due('4'), due('5')];
    const seen: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const summary = await runRefreshTick(
      makeDeps(titles, async (t) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        seen.push(t.id);
        await Bun.sleep(0);
        inFlight--;
      }, 2),
      newBackoff(),
    );

    expect(seen).toEqual(['1', '2']);
    expect(maxInFlight).toBe(1);
    expect(summary).toEqual({ status: 'ran', attempted: 2, refreshed: 2, failed: 0 });
  });

  test('pula títulos com metadados recentes (não gasta cota com quem não venceu)', async () => {
    const fresh = { ...due('fresh'), metadata_refreshed_at: new Date(T0.getTime() - 60 * MIN).toISOString() };
    const seen: string[] = [];

    await runRefreshTick(
      makeDeps([fresh, due('stale')], async (t) => {
        seen.push(t.id);
      }),
      newBackoff(),
    );

    expect(seen).toEqual(['stale']);
  });

  test('sem nada vencido: não chama o provider e não erra', async () => {
    const fresh = { ...due('fresh'), metadata_refreshed_at: new Date(T0.getTime() - 60 * MIN).toISOString() };
    let calls = 0;
    const summary = await runRefreshTick(makeDeps([fresh], async () => void calls++), newBackoff());
    expect(calls).toBe(0);
    expect(summary.attempted).toBe(0);
  });
});

describe('runRefreshTick: backoff em 429 e 5xx', () => {
  test('503 para o tick: os demais títulos da rodada não são tentados', async () => {
    const seen: string[] = [];
    const backoff = newBackoff();

    const summary = await runRefreshTick(
      makeDeps([due('1'), due('2'), due('3')], async (t) => {
        seen.push(t.id);
        if (t.id === '1') throw new TmdbRequestError(503, 'TMDB /tv/1 respondeu 503');
      }, 5),
      backoff,
    );

    expect(seen).toEqual(['1']);
    expect(summary).toMatchObject({ status: 'ran', failed: 1, refreshed: 0 });
    expect(backoff.failures).toBe(1);
    expect(backoff.retryAt).toBe(T0.getTime() + BACKOFF_BASE_MS);
  });

  test('429 também é transitório: entra em backoff', async () => {
    const backoff = newBackoff();
    await runRefreshTick(makeDeps([due('1')], async () => {
      throw new TmdbRequestError(429, 'TMDB /tv/1 respondeu 429');
    }), backoff);
    expect(backoff.retryAt).toBeGreaterThan(T0.getTime());
  });

  test('enquanto estiver em backoff, o tick não chama o provider', async () => {
    const { clock, now } = makeClock();
    const backoff = newBackoff();
    await runRefreshTick(makeDeps([due('1')], async () => {
      throw new TmdbRequestError(503, 'x');
    }, 2, now), backoff);

    clock.ms += BACKOFF_BASE_MS - 1;
    let calls = 0;
    const summary = await runRefreshTick(makeDeps([due('1')], async () => void calls++, 2, now), backoff);

    expect(calls).toBe(0);
    expect(summary.status).toBe('backoff');
  });

  test('o atraso dobra a cada falha seguida e para no teto', async () => {
    const { clock, now } = makeClock();
    const backoff = newBackoff();
    const failing: TickDeps['refresh'] = async () => {
      throw new TmdbRequestError(502, 'x');
    };

    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await runRefreshTick(makeDeps([due(`t${i}`)], failing, 2, now), backoff);
      delays.push(backoff.retryAt - clock.ms);
      clock.ms = backoff.retryAt; // próxima tentativa exatamente quando o backoff acaba
    }

    expect(delays.slice(0, 4)).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2, BACKOFF_BASE_MS * 4, BACKOFF_BASE_MS * 8]);
    expect(Math.max(...delays)).toBe(BACKOFF_MAX_MS);
  });

  test('uma tick bem-sucedida depois de falhas zera o contador de backoff', async () => {
    const { clock, now } = makeClock();
    const backoff = newBackoff();
    await runRefreshTick(makeDeps([due('1')], async () => {
      throw new TmdbRequestError(500, 'x');
    }, 2, now), backoff);
    clock.ms = backoff.retryAt;

    await runRefreshTick(makeDeps([due('2')], async () => {}, 2, now), backoff);

    expect(backoff.failures).toBe(0);
    expect(backoff.retryAt).toBeLessThanOrEqual(clock.ms);
  });
});

describe('runRefreshTick: erro de um título só (não transitório)', () => {
  test('404 de um título: conta como falha, segue para o próximo e não o retenta no tick seguinte', async () => {
    const { clock, now } = makeClock();
    const backoff = newBackoff();
    const seen: string[] = [];
    const refresh: TickDeps['refresh'] = async (t) => {
      seen.push(t.id);
      if (t.id === 'gone') throw new TmdbRequestError(404, 'TMDB /tv/gone respondeu 404');
    };

    const first = await runRefreshTick(makeDeps([due('gone'), due('ok')], refresh, 5, now), backoff);
    expect(first).toMatchObject({ failed: 1, refreshed: 1 });
    expect(backoff.failures).toBe(0);

    clock.ms += 10 * MIN;
    seen.length = 0;
    await runRefreshTick(makeDeps([due('gone'), due('ok')], refresh, 5, now), backoff);
    expect(seen).toEqual(['ok']);
  });

  test('título que dá 5xx três vezes seguidas sai da fila por um tempo e não trava os demais', async () => {
    const { clock, now } = makeClock();
    const state = newBackoff();
    const seen: string[] = [];
    const refresh: TickDeps['refresh'] = async (t) => {
      seen.push(t.id);
      if (t.id === 'bad') throw new TmdbRequestError(500, 'TMDB /tv/bad respondeu 500');
    };
    const titles = [due('bad'), due('good')];

    for (let i = 0; i < 3; i++) {
      await runRefreshTick(makeDeps(titles, refresh, 5, now), state);
      clock.ms = state.retryAt;
    }
    seen.length = 0;
    const summary = await runRefreshTick(makeDeps(titles, refresh, 5, now), state);

    expect(seen).toEqual(['good']);
    expect(summary).toMatchObject({ refreshed: 1, failed: 0 });
  });

  test('o título com 404 volta a ser tentado depois de uma janela de descanso', async () => {
    const { clock, now } = makeClock();
    const backoff = newBackoff();
    const seen: string[] = [];
    const refresh: TickDeps['refresh'] = async (t) => {
      seen.push(t.id);
      throw new TmdbRequestError(404, 'x');
    };
    await runRefreshTick(makeDeps([due('gone')], refresh, 5, now), backoff);
    clock.ms += 25 * 60 * MIN;
    await runRefreshTick(makeDeps([due('gone')], refresh, 5, now), backoff);
    expect(seen).toEqual(['gone', 'gone']);
  });
});

describe('startRefreshJob', () => {
  test('desligado (sem TMDB_API_KEY): não agenda nenhum tick', async () => {
    let ticks = 0;
    const handle = startRefreshJob({ enabled: false, intervalMs: 1, initialDelayMs: 0, tick: async () => void ticks++, log: () => {} });
    await Bun.sleep(20);
    handle.stop();
    expect(ticks).toBe(0);
  });

  test('stop() antes do primeiro tick cancela o agendamento', async () => {
    let ticks = 0;
    const handle = startRefreshJob({ enabled: true, intervalMs: 1, initialDelayMs: 0, tick: async () => void ticks++, log: () => {} });
    handle.stop();
    await Bun.sleep(20);
    expect(ticks).toBe(0);
  });

  test('erro lançado pelo tick é logado e o laço continua agendando', async () => {
    let ticks = 0;
    const logged: string[] = [];
    const handle = startRefreshJob({
      enabled: true,
      intervalMs: 1,
      initialDelayMs: 0,
      tick: async () => {
        ticks++;
        throw new Error('boom');
      },
      log: (m) => logged.push(m),
    });
    await Bun.sleep(30);
    handle.stop();
    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(logged[0]).toContain('boom');
  });
});

describe('describeError', () => {
  test('nunca devolve a chave da TMDB, mesmo que ela apareça na mensagem', () => {
    const secret = 'SEGREDO_DE_TESTE_123';
    const msg = describeError(new Error(`falhou em https://x/?api_key=${secret}`), [secret]);
    expect(msg).not.toContain(secret);
    expect(msg).toContain('[redigida]');
  });

  test('erro da TMDB usa só a mensagem curta (status + caminho), sem URL', () => {
    expect(describeError(new TmdbRequestError(429, 'TMDB /tv/1 respondeu 429'), ['abc'])).toBe('TMDB /tv/1 respondeu 429');
  });
});
