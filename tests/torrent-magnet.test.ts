import { describe, expect, test } from 'bun:test';
import {
  MagnetError,
  buildMagnet,
  cleanName,
  isPrivateHost,
  isSafeTorrentPath,
  parseInfoHash,
  parseMagnet,
  safeTrackers,
} from '../src/server/torrent/magnet.ts';

/**
 * A entrada do provider genérico é a única porta por onde um magnet de terceiro chega ao engine.
 * Estes testes fixam o que entra (infohash exato, trackers públicos) e o que é recusado (o resto).
 */

const HEX = '0123456789abcdef0123456789abcdef01234567';
// Vetor base32 gerado por um encoder RFC 4648 independente (scratchpad), não pelo decoder deste projeto.
const BASE32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';

describe('parseInfoHash', () => {
  test('aceita 40 hex e normaliza para minúsculas', () => {
    expect(parseInfoHash(HEX.toUpperCase())).toBe(HEX);
    expect(parseInfoHash(HEX)).toBe(HEX);
  });

  test('aceita 32 base32 e devolve o mesmo infohash em hex', () => {
    expect(parseInfoHash(BASE32)).toBe(HEX);
    expect(parseInfoHash(BASE32.toLowerCase())).toBe(HEX);
  });

  test('recusa tamanhos errados, caracteres fora do alfabeto e vazio', () => {
    expect(parseInfoHash(HEX.slice(1))).toBeNull();
    expect(parseInfoHash(`${HEX}0`)).toBeNull();
    expect(parseInfoHash(`${'g'.repeat(40)}`)).toBeNull();
    expect(parseInfoHash(BASE32.slice(1))).toBeNull();
    // `1`, `0`, `8` e `9` não existem no alfabeto base32: o caractere sozinho já invalida.
    expect(parseInfoHash(`1${BASE32.slice(1)}`)).toBeNull();
    expect(parseInfoHash('')).toBeNull();
  });
});

describe('parseMagnet', () => {
  test('extrai infohash, nome e trackers públicos', () => {
    const ref = parseMagnet(
      `magnet:?xt=urn:btih:${HEX}&dn=Filme%20Teste&tr=udp%3A%2F%2Ftracker.example.org%3A6969%2Fannounce`,
    );
    expect(ref).toEqual({
      infoHash: HEX,
      name: 'Filme Teste',
      trackers: ['udp://tracker.example.org:6969/announce'],
    });
  });

  test('o esquema é case-insensitive e o prefixo do xt também', () => {
    expect(parseMagnet(`MAGNET:?XT=URN:BTIH:${HEX.toUpperCase()}`).infoHash).toBe(HEX);
  });

  test('recusa magnet sem infohash BitTorrent (só btmh v2, ou nenhum xt)', () => {
    expect(() => parseMagnet('magnet:?dn=sem-hash')).toThrow(MagnetError);
    expect(() => parseMagnet('magnet:?xt=urn:btmh:1220abcdef')).toThrow(MagnetError);
  });

  test('recusa infohash malformado, em vez de passar adiante', () => {
    expect(() => parseMagnet('magnet:?xt=urn:btih:nao-e-hash')).toThrow(/infohash inválido/);
  });

  test('recusa dois infohashes diferentes (ambíguo); o mesmo repetido é aceito', () => {
    const other = 'f'.repeat(40);
    expect(() => parseMagnet(`magnet:?xt=urn:btih:${HEX}&xt=urn:btih:${other}`)).toThrow(/mais de um infohash/);
    expect(parseMagnet(`magnet:?xt=urn:btih:${HEX}&xt=urn:btih:${HEX}`).infoHash).toBe(HEX);
  });

  test('recusa entrada que não é magnet nem URL válida', () => {
    expect(() => parseMagnet('nao e magnet')).toThrow(MagnetError);
    expect(() => parseMagnet(`magnet:?xt=urn:btih:${HEX}`.padEnd(5000, 'a'))).toThrow(/grande demais/);
  });
});

describe('buildMagnet', () => {
  test('reconstrói só xt, dn e tr; parâmetros desconhecidos somem', () => {
    const magnet = buildMagnet(
      parseMagnet(`magnet:?xt=urn:btih:${HEX}&dn=A&x.pe=10.0.0.9:6881&ws=https%3A%2F%2Fevil.example%2F&so=0&tr=https%3A%2F%2Ft.example.org%2Fannounce`),
    );
    expect(magnet).toBe(`magnet:?xt=urn:btih:${HEX}&dn=A&tr=${encodeURIComponent('https://t.example.org/announce')}`);
    expect(magnet).not.toContain('x.pe');
    expect(magnet).not.toContain('evil.example');
  });

  test('ida e volta é estável: o magnet canônico lê o mesmo TorrentRef', () => {
    const ref = parseMagnet(`magnet:?xt=urn:btih:${HEX}&dn=Nome%20com%20espaço&tr=udp%3A%2F%2Ft.example.org%3A1%2Fa`);
    expect(parseMagnet(buildMagnet(ref))).toEqual(ref);
  });
});

describe('cleanName', () => {
  test('tira controle (quebra de linha no nome não vira cabeçalho nem linha na UI)', () => {
    expect(cleanName('Filme\r\nSet-Cookie: x\u0000')).toBe('FilmeSet-Cookie: x');
  });

  test('limita o tamanho e devolve vazio para ausente', () => {
    expect(cleanName('a'.repeat(500))).toHaveLength(200);
    expect(cleanName(null)).toBe('');
    expect(cleanName(undefined)).toBe('');
  });
});

describe('safeTrackers e isPrivateHost', () => {
  test('descarta loopback, LAN, link-local, IPv6 local e localhost', () => {
    const hostile = [
      'http://localhost/announce',
      'http://app.localhost/announce',
      'udp://127.0.0.1:6969',
      'http://10.0.0.1/announce',
      'http://192.168.1.5/announce',
      'http://172.16.0.1/announce',
      'http://169.254.10.10/announce',
      'http://[::1]/announce',
      'http://[fd00::1]/announce',
      'http://[fe80::1]/announce',
      'http://0.0.0.0/announce',
    ];
    expect(safeTrackers(hostile)).toEqual([]);
  });

  test('mantém trackers públicos, incluindo a faixa 172.32 que não é privada', () => {
    expect(safeTrackers(['udp://tracker.example.org:6969', 'https://t.example.org/a', 'http://172.32.0.1/a'])).toEqual([
      'udp://tracker.example.org:6969',
      'https://t.example.org/a',
      'http://172.32.0.1/a',
    ]);
  });

  test('descarta esquemas que não são de tracker e entradas que não parseiam', () => {
    expect(safeTrackers(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://t.example.org/', 'não é url'])).toEqual([]);
  });

  test('deduplica e limita o número de trackers', () => {
    const many = Array.from({ length: 50 }, (_, i) => `udp://t${i}.example.org:6969`);
    expect(safeTrackers([...many, many[0] as string])).toHaveLength(20);
  });

  test('isPrivateHost reconhece as faixas que o provider recusa', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('example.org')).toBe(false);
  });

  test('IPv4 embutido em IPv6 vale como o IPv4 (::ffff:7f00:1 é loopback)', () => {
    for (const host of ['[::ffff:7f00:1]', '[::ffff:127.0.0.1]', '[::ffff:c0a8:a]', '[::ffff:a00:1]', '[::127.0.0.1]', '[::7f00:1]', '[::ffff:ac10:1]']) {
      expect(isPrivateHost(host)).toBe(true);
    }
    expect(isPrivateHost('[::ffff:808:808]')).toBe(false);
    expect(isPrivateHost('[2606:4700:4700::1111]')).toBe(false);
    expect(isPrivateHost('[fec0::1]')).toBe(true);
  });

  test('esquemas sem host especial (udp:) escrevem o IPv4 de outras formas; todas valem como o IPv4', () => {
    const hostile = ['udp://2130706433:6969', 'udp://127.1:6969', 'udp://0x7f000001:6969', 'udp://0177.0.0.1:6969', 'udp://localhost.:6969', 'udp://[::ffff:7f00:1]:6969', 'http://[::ffff:7f00:1]:1/announce'];
    expect(safeTrackers(hostile)).toEqual([]);
    expect(isPrivateHost('2130706433')).toBe(true);
    expect(isPrivateHost('localhost.')).toBe(true);
  });
});

describe('isSafeTorrentPath — traversal via nomes dentro do torrent', () => {
  test('aceita caminhos relativos comuns, inclusive com espaço, colchete e dois pontos no meio', () => {
    expect(isSafeTorrentPath('Serie/Temporada 1/Ep 01 [720p].mp4')).toBe(true);
    expect(isSafeTorrentPath('Filme (1954).mkv')).toBe(true);
  });

  test('recusa `..` em qualquer posição, inclusive com barra invertida', () => {
    expect(isSafeTorrentPath('../../etc/cron.d/x')).toBe(false);
    expect(isSafeTorrentPath('a/../../x.mp4')).toBe(false);
    expect(isSafeTorrentPath('a\\..\\..\\x.mp4')).toBe(false);
    expect(isSafeTorrentPath('..')).toBe(false);
  });

  test('recusa caminho absoluto, unidade do Windows e UNC', () => {
    expect(isSafeTorrentPath('/etc/passwd')).toBe(false);
    expect(isSafeTorrentPath('\\\\servidor\\compartilhado\\x.mp4')).toBe(false);
    expect(isSafeTorrentPath('C:/Windows/evil.mp4')).toBe(false);
    expect(isSafeTorrentPath('C:evil.mp4')).toBe(false);
  });

  test('recusa segmento vazio, `.`, NUL e nome longdemais para o sistema de arquivos', () => {
    expect(isSafeTorrentPath('')).toBe(false);
    expect(isSafeTorrentPath('a//b.mp4')).toBe(false);
    expect(isSafeTorrentPath('./x.mp4')).toBe(false);
    expect(isSafeTorrentPath('a\u0000b.mp4')).toBe(false);
    expect(isSafeTorrentPath(`${'a'.repeat(256)}.mp4`)).toBe(false);
    expect(isSafeTorrentPath(`${'a'.repeat(251)}.mp4`)).toBe(true);
  });
});
