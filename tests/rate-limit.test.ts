import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from '../src/server/rate-limit.ts';

describe('createRateLimiter.isFull', () => {
  test('consulta sem consumir a janela', () => {
    const limiter = createRateLimiter('login', 2, 1000, () => 0);
    expect(limiter.isFull()).toBe(false);
    expect(limiter.isFull()).toBe(false);
    limiter.acquire();
    limiter.acquire();
    expect(limiter.isFull()).toBe(true);
    expect(() => limiter.acquire()).toThrow();
  });

  test('volta a ter vaga quando a janela desliza', () => {
    let t = 0;
    const limiter = createRateLimiter('login', 1, 1000, () => t);
    limiter.acquire();
    expect(limiter.isFull()).toBe(true);
    t = 1000;
    expect(limiter.isFull()).toBe(false);
  });
});
