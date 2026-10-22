import { describe, expect, test } from 'bun:test';
import { handleOf, parseChannelInput, parseHandle, parseInstanceHost } from '../src/server/providers/peertube/host.ts';

/**
 * O servidor faz a requisição para a instância escolhida pelo usuário: cada caso aqui é uma porta de SSRF que
 * não pode abrir (rede local, IP literal, porta estranha, credenciais, http puro).
 */
describe('parseInstanceHost (SSRF)', () => {
  test.each(['framatube.org', 'video.blender.org', 'XN--80ak6aa92e.com'])('aceita host público %s', (host) => {
    expect(parseInstanceHost(host)).toBe(host.toLowerCase());
  });

  test.each([
    ['localhost', 'nome local'],
    ['intranet.localhost', 'sufixo .localhost'],
    ['nas.local', 'mDNS'],
    ['server.internal', 'nome interno'],
    ['router.lan', 'LAN'],
    ['127.0.0.1', 'IPv4 loopback literal'],
    ['10.0.0.5', 'IPv4 privado literal'],
    ['192.168.1.10', 'IPv4 de LAN literal'],
    ['169.254.169.254', 'metadados de nuvem'],
    ['0x7f000001', 'IP em hexadecimal'],
    ['2130706433', 'IP inteiro'],
    ['[::1]', 'IPv6 loopback'],
    ['peertube.example', 'domínio reservado'],
    ['host.test', 'domínio de teste'],
    ['host:8443', 'porta explícita'],
    ['', 'vazio'],
    [`${'a'.repeat(254)}.org`, 'nome longo demais'],
    ['-bad.org', 'rótulo começando com hífen'],
    ['exa mple.org', 'espaço'],
  ])('recusa %s (%s)', (host) => {
    expect(parseInstanceHost(host)).toBeNull();
  });
});

describe('parseChannelInput', () => {
  test.each([
    ['joinpeertube@framatube.org', { name: 'joinpeertube', host: 'framatube.org' }],
    ['  Blender_Open_Movies@Video.Blender.org  ', { name: 'blender_open_movies', host: 'video.blender.org' }],
    ['https://framatube.org/c/joinpeertube', { name: 'joinpeertube', host: 'framatube.org' }],
    ['https://framatube.org/video-channels/joinpeertube/', { name: 'joinpeertube', host: 'framatube.org' }],
    ['https://framatube.org:443/c/joinpeertube', { name: 'joinpeertube', host: 'framatube.org' }],
  ])('aceita %s', (input, expected) => {
    expect(parseChannelInput(input)).toEqual(expected);
  });

  test.each([
    'http://framatube.org/c/joinpeertube', // sem TLS
    'ftp://framatube.org/c/joinpeertube',
    'https://localhost/c/joinpeertube',
    'https://127.0.0.1/c/joinpeertube',
    'https://10.0.0.5/c/joinpeertube',
    'https://[::1]/c/joinpeertube',
    'https://framatube.org:8443/c/joinpeertube', // porta estranha
    'https://user:pass@framatube.org/c/joinpeertube', // credenciais embutidas
    'https://framatube.org/c/joinpeertube/../../api/v1/users', // path traversal
    'https://framatube.org/watch/abc',
    'joinpeertube@localhost',
    'joinpeertube@192.168.0.1',
    'joinpeertube@framatube.org:8443',
    'joinpeertube@framatube.org/../x',
    '../../etc@framatube.org',
    '@framatube.org',
    'joinpeertube@',
    'canal com espaço@framatube.org',
  ])('recusa %s', (input) => {
    expect(parseChannelInput(input)).toBeNull();
  });
});

describe('handle guardado no banco', () => {
  test('ida e volta: handleOf -> parseHandle devolve o mesmo canal', () => {
    const handle = handleOf({ name: 'joinpeertube', host: 'framatube.org' });
    expect(handle).toBe('peertube:joinpeertube@framatube.org');
    expect(parseHandle(handle)).toEqual({ name: 'joinpeertube', host: 'framatube.org' });
  });

  test('um handle adulterado (backup importado) é revalidado e recusado', () => {
    expect(parseHandle('peertube:x@127.0.0.1')).toBeNull();
    expect(parseHandle('peertube:x@localhost')).toBeNull();
    expect(parseHandle('youtube:channel:UCxxxxxxxxxxxxxxxxxxxxxx')).toBeNull();
    expect(parseHandle('peertube:../x@framatube.org')).toBeNull();
  });
});
