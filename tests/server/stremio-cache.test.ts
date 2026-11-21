import { afterEach, describe, expect, test } from 'bun:test';
import { addonCacheSize, cachedAddonJson, clearAddonCache, DEFAULT_TTL_MS, MAX_ENTRIES, MAX_TTL_MS, ttlFromBody } from '../../src/server/providers/stremio/cache.ts';

/**
 * Cache curto das respostas de addon: o protocolo já diz por quanto tempo a resposta vale
 * (`cacheMaxAge`), com teto nosso porque link de debrid expira antes de uma hora.
 */
afterEach(() => clearAddonCache());

describe('ttlFromBody', () => {
  test('usa cacheMaxAge em segundos e limita ao teto', () => {
    expect(ttlFromBody({ cacheMaxAge: 60 })).toBe(60_000);
    expect(ttlFromBody({ cacheMaxAge: 3600 })).toBe(MAX_TTL_MS);
  });

  test('ausente, zero ou lixo cai no padrão', () => {
    expect(ttlFromBody({})).toBe(DEFAULT_TTL_MS);
    expect(ttlFromBody({ cacheMaxAge: 0 })).toBe(DEFAULT_TTL_MS);
    expect(ttlFromBody({ cacheMaxAge: -5 })).toBe(DEFAULT_TTL_MS);
    expect(ttlFromBody({ cacheMaxAge: '60' })).toBe(DEFAULT_TTL_MS);
    expect(ttlFromBody(null)).toBe(DEFAULT_TTL_MS);
  });
});

describe('cachedAddonJson', () => {
  test('reaproveita dentro do TTL e refaz depois', async () => {
    let now = 1_000;
    let calls = 0;
    const fetchJson = async () => {
      calls++;
      return { cacheMaxAge: 30, v: calls };
    };
    expect(await cachedAddonJson('https://a.example/x.json', fetchJson, { now: () => now })).toMatchObject({ v: 1 });
    now += 29_000;
    expect(await cachedAddonJson('https://a.example/x.json', fetchJson, { now: () => now })).toMatchObject({ v: 1 });
    now += 2_000;
    expect(await cachedAddonJson('https://a.example/x.json', fetchJson, { now: () => now })).toMatchObject({ v: 2 });
    expect(calls).toBe(2);
  });

  test('sem cacheMaxAge usa o padrão do recurso', async () => {
    let now = 0;
    let calls = 0;
    const fetchJson = async () => {
      calls++;
      return { streams: [] };
    };
    await cachedAddonJson('https://a.example/s.json', fetchJson, { now: () => now, ttlMs: 5_000 });
    now += 4_999;
    await cachedAddonJson('https://a.example/s.json', fetchJson, { now: () => now, ttlMs: 5_000 });
    expect(calls).toBe(1);
    now += 2;
    await cachedAddonJson('https://a.example/s.json', fetchJson, { now: () => now, ttlMs: 5_000 });
    expect(calls).toBe(2);
  });

  test('duas chamadas simultâneas compartilham a requisição', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const fetchJson = async () => {
      calls++;
      await gate;
      return { cacheMaxAge: 60 };
    };
    const first = cachedAddonJson('https://a.example/x.json', fetchJson);
    const second = cachedAddonJson('https://a.example/x.json', fetchJson);
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  test('erro não entra no cache', async () => {
    let calls = 0;
    const failing = async (): Promise<unknown> => {
      calls++;
      throw new Error('addon fora do ar');
    };
    await expect(cachedAddonJson('https://a.example/e.json', failing)).rejects.toThrow('addon fora do ar');
    await expect(cachedAddonJson('https://a.example/e.json', failing)).rejects.toThrow('addon fora do ar');
    expect(calls).toBe(2);
  });

  test('URLs diferentes não compartilham e o total tem teto', async () => {
    const fetchJson = async () => ({ cacheMaxAge: 60 });
    for (let i = 0; i < MAX_ENTRIES + 5; i++) await cachedAddonJson(`https://a.example/${i}.json`, fetchJson);
    expect(addonCacheSize()).toBeLessThanOrEqual(MAX_ENTRIES);
  });
});
