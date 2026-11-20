import { describe, expect, test } from 'bun:test';
import { mapLimit } from '../../src/server/lib/map-limit.ts';

/** Fan-out com teto de requisições em voo: a ordem do resultado não muda. */
describe('mapLimit', () => {
  test('preserva a ordem mesmo terminando fora de ordem', async () => {
    const result = await mapLimit([30, 10, 20, 5], 2, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${index}:${ms}`;
    });
    expect(result).toEqual(['0:30', '1:10', '2:20', '3:5']);
  });

  test('nunca passa do limite de chamadas simultâneas', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return null;
    });
    expect(peak).toBe(3);
  });

  test('limite maior que a lista, lista vazia e limite inválido não quebram', async () => {
    expect(await mapLimit([1, 2], 10, async (n) => n * 2)).toEqual([2, 4]);
    expect(await mapLimit([], 4, async () => 'x')).toEqual([]);
    expect(await mapLimit([1], 0, async (n) => n)).toEqual([1]);
  });

  test('erro de um item rejeita a chamada (quem chama já trata por addon)', async () => {
    await expect(
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('falhou');
        return n;
      }),
    ).rejects.toThrow('falhou');
  });
});
