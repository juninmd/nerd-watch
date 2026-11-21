import { describe, expect, test } from 'bun:test';
import { listenHost, portEnv, positiveIntEnv } from '../../src/server/config/config.ts';

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

describe('portEnv e positiveIntEnv', () => {
  test('portEnv aceita porta válida e cai no padrão em lixo, zero ou acima de 65535', () => {
    expect(portEnv('8080', 7799, 1)).toBe(8080);
    expect(portEnv('0', 0, 0)).toBe(0);
    expect(portEnv('0', 7799, 1)).toBe(7799);
    expect(portEnv('70000', 7799, 1)).toBe(7799);
    expect(portEnv('abc', 7799, 1)).toBe(7799);
    expect(portEnv('-5', 7799, 1)).toBe(7799);
    expect(portEnv('80.5', 7799, 1)).toBe(7799);
  });

  test('positiveIntEnv devolve undefined para lixo, zero ou negativo', () => {
    expect(positiveIntEnv('123456')).toBe(123456);
    expect(positiveIntEnv('0')).toBeUndefined();
    expect(positiveIntEnv('abc')).toBeUndefined();
    expect(positiveIntEnv('-1')).toBeUndefined();
  });
});
