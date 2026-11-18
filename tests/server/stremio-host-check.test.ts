import { afterEach, describe, expect, test } from 'bun:test';
import { parseAddonUrl } from '../../src/server/providers/stremio/url.ts';
import { checkResolvedHost, setHostResolver } from '../../src/server/subtitles/load.ts';

const MANIFEST = 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json';

afterEach(() => setHostResolver());

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
});
