import { describe, expect, test } from 'bun:test';
import { addonMagnet, addonTorrentRef, trackersFromSources } from '../../src/server/torrent/addon-torrent.ts';

/**
 * A ponte addon → engine é onde um dado de terceiro vira magnet. Os casos que importam são os de
 * recusa: infohash curto/base32 inválido, tracker apontando para a máquina do usuário e `dht:`
 * virando parâmetro de magnet.
 */

const HASH = 'c1'.repeat(20);

describe('trackersFromSources', () => {
  test('tira o prefixo tracker:, ignora dht: e o que não é tracker', () => {
    expect(
      trackersFromSources([
        'tracker:udp://tracker.example.org:1337/announce',
        'tracker:https://tracker.example.net/announce',
        'dht:c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1',
        'ws://não-é-tracker.example',
        'tracker:',
      ]),
    ).toEqual(['udp://tracker.example.org:1337/announce', 'https://tracker.example.net/announce']);
  });

  test('tracker em loopback ou rede privada é descartado', () => {
    expect(trackersFromSources(['tracker:http://127.0.0.1:8080/announce', 'tracker:udp://192.168.0.2:6969/announce', 'tracker:udp://10.0.0.1:80'])).toEqual([]);
  });

  test('duplicado entra uma vez e há teto de trackers', () => {
    const many = Array.from({ length: 30 }, (_, i) => `tracker:udp://t${i}.example.org:6969/announce`);
    const out = trackersFromSources([many[0] as string, many[0] as string, ...many]);
    expect(out).toHaveLength(20);
    expect(new Set(out).size).toBe(20);
  });
});

describe('addonTorrentRef', () => {
  test('normaliza infohash e nome, mantendo só trackers válidos', () => {
    const ref = addonTorrentRef({
      infoHash: HASH.toUpperCase(),
      name: 'Filme 2024 1080p',
      sources: ['tracker:udp://tracker.example.org:1337/announce', 'dht:abc'],
    });
    expect(ref).toEqual({ infoHash: HASH, name: 'Filme 2024 1080p', trackers: ['udp://tracker.example.org:1337/announce'] });
  });

  test('infohash inválido devolve null (o stream não vira torrent)', () => {
    expect(addonTorrentRef({ infoHash: 'abc' })).toBeNull();
    expect(addonTorrentRef({ infoHash: '' })).toBeNull();
    expect(addonTorrentRef({ infoHash: 42 })).toBeNull();
    expect(addonTorrentRef({})).toBeNull();
  });

  test('nome com caractere de controle é limpo antes de ir para a interface', () => {
    const ref = addonTorrentRef({ infoHash: HASH, name: 'Filme\u0000\u0007 1080p' });
    expect(ref?.name).toBe('Filme 1080p');
  });

  test('magnet final é canônico: xt do infohash, dn e um tr por tracker', () => {
    const ref = addonTorrentRef({ infoHash: HASH, name: 'Filme', sources: ['tracker:udp://tracker.example.org:1337/announce'] });
    expect(ref && addonMagnet(ref)).toBe(`magnet:?xt=urn:btih:${HASH}&dn=Filme&tr=udp%3A%2F%2Ftracker.example.org%3A1337%2Fannounce`);
  });
});
