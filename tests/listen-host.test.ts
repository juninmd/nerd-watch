import { describe, expect, test } from 'bun:test';
import { listenHost } from '../src/server/config.ts';

describe('listenHost', () => {
  test('padrão é loopback: o app local nunca escuta na rede por acidente', () => {
    expect(listenHost(undefined)).toBe('127.0.0.1');
    expect(listenHost('')).toBe('127.0.0.1');
    expect(listenHost('   ')).toBe('127.0.0.1');
  });

  test('HOST explícito vale (o container precisa de 0.0.0.0 para receber o port mapping)', () => {
    expect(listenHost('0.0.0.0')).toBe('0.0.0.0');
    expect(listenHost(' 127.0.0.1 ')).toBe('127.0.0.1');
  });
});
