import { describe, expect, test } from 'bun:test';
import { withCache } from '../src/server/cache.ts';

describe('withCache', () => {
  test('reaproveita o resultado enquanto o TTL não expirou', async () => {
    let calls = 0;
    const fn = withCache(1000, async (x: number) => {
      calls++;
      return x * 2;
    });

    expect(await fn(3)).toBe(6);
    expect(await fn(3)).toBe(6);
    expect(calls).toBe(1);
  });

  test('chama de novo após o TTL expirar', async () => {
    let calls = 0;
    const fn = withCache(10, async () => {
      calls++;
      return calls;
    });

    expect(await fn()).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(await fn()).toBe(2);
  });

  test('chaves diferentes não colidem', async () => {
    const fn = withCache(1000, async (x: string) => x.toUpperCase());
    expect(await fn('a')).toBe('A');
    expect(await fn('b')).toBe('B');
  });

  test('erros não são cacheados', async () => {
    let calls = 0;
    const fn = withCache(1000, async () => {
      calls++;
      if (calls === 1) throw new Error('falha temporária');
      return 'ok';
    });

    await expect(fn()).rejects.toThrow('falha temporária');
    expect(await fn()).toBe('ok');
    expect(calls).toBe(2);
  });
});
