import { describe, expect, test } from 'bun:test';
import { cancelCountdown, startCountdown, tickCountdown, UP_NEXT_SECONDS } from '../src/client/player-countdown.ts';

describe('contagem do próximo vídeo', () => {
  test('começa em 5 s e desce um por tick até acabar', () => {
    expect(UP_NEXT_SECONDS).toBe(5);
    let c = startCountdown(UP_NEXT_SECONDS);
    expect(c).toEqual({ remaining: 5, status: 'running' });
    c = tickCountdown(c);
    expect(c).toEqual({ remaining: 4, status: 'running' });
    c = tickCountdown(tickCountdown(tickCountdown(c)));
    expect(c).toEqual({ remaining: 1, status: 'running' });
    c = tickCountdown(c);
    expect(c).toEqual({ remaining: 0, status: 'done' });
  });

  test('cancelada não avança mais, mesmo com ticks depois', () => {
    const cancelled = cancelCountdown(tickCountdown(startCountdown(5)));
    expect(cancelled.status).toBe('cancelled');
    expect(tickCountdown(cancelled)).toEqual(cancelled);
  });

  test('cancelar uma contagem já encerrada não muda o estado', () => {
    const done = { remaining: 0, status: 'done' as const };
    expect(cancelCountdown(done)).toEqual(done);
  });

  test('tick em contagem terminada não fica negativo', () => {
    expect(tickCountdown({ remaining: 0, status: 'done' })).toEqual({ remaining: 0, status: 'done' });
  });

  test('zero, negativo, fracionário ou NaN: começa já encerrada (quem chama toca na hora)', () => {
    expect(startCountdown(0)).toEqual({ remaining: 0, status: 'done' });
    expect(startCountdown(-3)).toEqual({ remaining: 0, status: 'done' });
    expect(startCountdown(Number.NaN)).toEqual({ remaining: 0, status: 'done' });
    expect(startCountdown(2.7)).toEqual({ remaining: 2, status: 'running' });
  });
});
