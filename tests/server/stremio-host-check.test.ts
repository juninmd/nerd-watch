import { afterEach, describe, expect, test } from 'bun:test';
import { AddonError, getAddonJson, setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { parseAddonUrl } from '../../src/server/providers/stremio/url.ts';
import { checkResolvedHost, setHostResolver } from '../../src/server/subtitles/load.ts';

const MANIFEST = 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json';

afterEach(() => {
  setHostResolver();
  setAddonFetch();
});

describe('addon em host público (baby-beamup.club)', () => {
  test('o manifest passa na validação de texto', () => {
    expect(parseAddonUrl(MANIFEST).host).toBe('94c8cb9f702d-brazuca-torrents.baby-beamup.club');
  });

  test('o DNS é consultado com o hostname inteiro, sem cortar o último caractere', async () => {
    const asked: string[] = [];
    setHostResolver(async (host) => {
      asked.push(host);
      return ['172.67.222.90'];
    });
    expect(await checkResolvedHost(MANIFEST)).toBe('public');
    expect(asked).toEqual(['94c8cb9f702d-brazuca-torrents.baby-beamup.club']);
  });

  test('ponto final e colchetes são removidos, o resto do nome fica', async () => {
    const asked: string[] = [];
    setHostResolver(async (host) => {
      asked.push(host);
      return ['172.67.222.90'];
    });
    await checkResolvedHost('https://addon.example.com./manifest.json');
    expect(asked).toEqual(['addon.example.com']);
  });

  test('resolver para IP privado continua reprovado', async () => {
    setHostResolver(async () => ['10.0.0.5']);
    expect(await checkResolvedHost(MANIFEST)).toBe('private');
  });

  test('falha de DNS vira AddonError(unreachable) e Location malformada vira AddonError(http_status)', async () => {
    setHostResolver(async () => {
      throw new Error('ENOTFOUND');
    });
    const dnsErr = await getAddonJson(MANIFEST).catch((e: unknown) => e);
    expect(dnsErr).toBeInstanceOf(AddonError);
    expect((dnsErr as AddonError).failure).toBe('unreachable');

    setHostResolver(async () => ['172.67.222.90']);
    setAddonFetch(async () => new Response(null, { status: 302, headers: { location: 'http://[::1' } }));
    const redirErr = await getAddonJson(MANIFEST).catch((e: unknown) => e);
    expect(redirErr).toBeInstanceOf(AddonError);
    expect((redirErr as AddonError).failure).toBe('http_status');
  });
});
