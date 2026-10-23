import { describe, expect, test } from 'bun:test';
import { requestAllowed } from '../src/server/security.ts';

// Modo ACCESS_TOKEN (remote=true): o app pode ser alcançado por outro nome/IP, então o Host deixa de ser
// loopback. CSRF continua barrado pela igualdade Origin == Host em métodos que mudam estado.
describe('requestAllowed com remote=true (ACCESS_TOKEN ligado)', () => {
  test('aceita Host público (nome ou IP) em GET e em POST sem Origin, como scripts', () => {
    expect(requestAllowed('GET', 'nerd.example.com', '', true)).toBe(true);
    expect(requestAllowed('POST', '203.0.113.7:7799', '', true)).toBe(true);
  });

  test('POST com Origin igual ao Host passa, em http ou https (TLS no proxy)', () => {
    expect(requestAllowed('POST', 'nerd.example.com', 'https://nerd.example.com', true)).toBe(true);
    expect(requestAllowed('PATCH', 'nerd.example.com:7799', 'http://nerd.example.com:7799', true)).toBe(true);
    expect(requestAllowed('DELETE', 'NERD.example.com', 'https://nerd.example.com', true)).toBe(true);
  });

  test('POST com Origin de outro site é CSRF e bloqueia', () => {
    expect(requestAllowed('POST', 'nerd.example.com', 'https://evil.example.com', true)).toBe(false);
    expect(requestAllowed('POST', 'nerd.example.com', 'https://nerd.example.com.evil.com', true)).toBe(false);
  });

  test('Origin "null" (iframe sandbox) e Origin sem Host bloqueiam em escrita', () => {
    expect(requestAllowed('POST', 'nerd.example.com', 'null', true)).toBe(false);
    expect(requestAllowed('POST', '', 'https://', true)).toBe(false);
    expect(requestAllowed('POST', '', 'http://nerd.example.com', true)).toBe(false);
  });

  test('GET de outra origem segue passando (o cookie SameSite=Strict é que protege a leitura)', () => {
    expect(requestAllowed('GET', 'nerd.example.com', 'https://evil.example.com', true)).toBe(true);
  });
});

describe('requestAllowed sem remote (default local-first) segue inalterado', () => {
  test('Host público continua barrado', () => {
    expect(requestAllowed('GET', 'nerd.example.com', '')).toBe(false);
    expect(requestAllowed('GET', 'nerd.example.com', '', false)).toBe(false);
  });
});
