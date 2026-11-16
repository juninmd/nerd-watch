import { describe, expect, test } from 'bun:test';
import { fetchLatestRelease, isNewer, parseRelease } from '../../src/client/platform/update-check.ts';

const payload = { tag_name: 'v0.4.0', html_url: 'https://github.com/juninmd/nerd-watch/releases/tag/v0.4.0' };
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('checagem de atualização', () => {
  test('compara versões numericamente', () => {
    expect(isNewer('0.10.0', '0.9.5')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('lixo', '0.1.0')).toBe(false);
  });

  test('ignora rascunho, pré-lançamento e payload inválido', () => {
    expect(parseRelease(payload)).toEqual({ version: '0.4.0', url: payload.html_url });
    expect(parseRelease({ ...payload, prerelease: true })).toBeNull();
    expect(parseRelease({ ...payload, html_url: 'https://evil.test/x' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });

  test('usa cache e não quebra com falha de rede', async () => {
    const storage = memory();
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response(JSON.stringify(payload));
    }) as unknown as typeof fetch;
    expect((await fetchLatestRelease({ fetcher, storage, now: () => 1 }))?.version).toBe('0.4.0');
    await fetchLatestRelease({ fetcher, storage, now: () => 2 });
    expect(calls).toBe(1);
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLatestRelease({ fetcher: down, storage: memory() })).toBeNull();
  });
});
