import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { AddonUnavailableError, fetchAddonSubtitles, fetchManifest } from '../../src/server/providers/subtitles/stremio-addon.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

let seq = 0;
const uniqueBase = (host = 'subs-guard.example.com'): string => `https://${host}/case-${++seq}`;

beforeEach(() => {
  setHostResolver(async () => ['203.0.113.20']);
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
});

describe('segurança do cliente de legendas (stremio-addon)', () => {
  test('recusa host local ou privado antes de tocar a rede', async () => {
    let called = 0;
    setAddonFetch(async () => {
      called++;
      return new Response('{}');
    });

    await expect(fetchManifest('http://127.0.0.1:7000/a')).rejects.toBeInstanceOf(AddonUnavailableError);
    await expect(fetchAddonSubtitles('http://169.254.169.254/latest', 'movie', 'tt0000001')).rejects.toBeInstanceOf(
      AddonUnavailableError,
    );
    expect(called).toBe(0);
  });

  test('recusa domínio que resolve para IP privado', async () => {
    setHostResolver(async () => ['10.0.0.8']);
    let called = 0;
    setAddonFetch(async () => {
      called++;
      return new Response('{}');
    });

    await expect(fetchManifest(uniqueBase())).rejects.toBeInstanceOf(AddonUnavailableError);
    expect(called).toBe(0);
  });

  test('recusa redirecionamento para rede interna (não segue 302 para loopback)', async () => {
    const seen: string[] = [];
    setAddonFetch(async (url) => {
      seen.push(url);
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/secret.json' } });
    });

    await expect(fetchAddonSubtitles(uniqueBase(), 'movie', 'tt0000002')).rejects.toBeInstanceOf(AddonUnavailableError);
    expect(seen).toHaveLength(1);
  });

  test('recusa resposta acima do limite de tamanho como AddonUnavailableError', async () => {
    setAddonFetch(async () => new Response('x'.repeat(2 * 1024 * 1024 + 64), { status: 200 }));

    await expect(fetchManifest(uniqueBase())).rejects.toBeInstanceOf(AddonUnavailableError);
  });
});
