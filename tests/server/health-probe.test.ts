import { describe, expect, test } from 'bun:test';
import { cachedProbe, probeSources } from '../../src/server/health/probe.ts';

describe('probeSources', () => {
  test('mede o tempo de quem responde e marca falha de quem erra', async () => {
    let t = 0;
    const now = () => (t += 40);
    const fetcher = async (url: string) => {
      if (url.includes('anilist')) throw new Error('fora do ar');
      return { ok: true };
    };
    const r = await probeSources(fetcher, now);
    expect(r.find((p) => p.id === 'tvmaze')?.ok).toBe(true);
    expect(r.find((p) => p.id === 'tvmaze')?.ms).toBeGreaterThan(0);
    expect(r.find((p) => p.id === 'anilist')).toEqual({ id: 'anilist', label: 'AniList', ok: false, ms: null });
  });
  test('resposta HTTP de erro conta como falha, sem ms', async () => {
    const r = await probeSources(async () => ({ ok: false }));
    expect(r.every((p) => !p.ok && p.ms === null)).toBe(true);
  });
});

describe('cachedProbe', () => {
  test('reaproveita o resultado dentro do TTL e junta chamadas simultâneas', async () => {
    let calls = 0;
    let clock = 0;
    const c = cachedProbe(async () => { calls++; return []; }, () => clock, 60_000);
    await Promise.all([c(), c()]);
    await c();
    expect(calls).toBe(1);
    clock = 61_000;
    await c();
    expect(calls).toBe(2);
  });
});
