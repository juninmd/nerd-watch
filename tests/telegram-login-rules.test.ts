import { describe, expect, test } from 'bun:test';
import { qrSecondsLeft, validateApiHash, validateApiId } from '../src/client/telegram-login-rules.ts';

describe('validateApiId', () => {
  test('aceita 5 a 10 dígitos, com espaços nas pontas', () => {
    expect(validateApiId('12345')).toBeNull();
    expect(validateApiId(' 1234567890 ')).toBeNull();
  });

  test.each(['1234', '12345678901', '12a45', '', '-12345'])('rejeita %p', (value) => {
    expect(validateApiId(value)).not.toBeNull();
  });
});

describe('validateApiHash', () => {
  test('aceita 32 hexadecimais em qualquer caixa', () => {
    expect(validateApiHash('0123456789abcdef0123456789ABCDEF')).toBeNull();
  });

  test.each(['', 'curto', '0123456789abcdef0123456789abcdeg', '0123456789abcdef0123456789abcdef0'])('rejeita %p', (value) => {
    expect(validateApiHash(value)).not.toBeNull();
  });
});

describe('qrSecondsLeft', () => {
  const now = 1_800_000_000_000;

  test('conta os segundos restantes a partir do timestamp Unix do Telegram', () => {
    expect(qrSecondsLeft(1_800_000_030, now)).toBe(30);
    expect(qrSecondsLeft(1_800_000_000.4, now)).toBe(1);
  });

  test('token já vencido fica em zero, nunca negativo', () => {
    expect(qrSecondsLeft(1_799_999_990, now)).toBe(0);
  });

  test('sem timestamp confiável não inventa contagem', () => {
    expect(qrSecondsLeft(0, now)).toBeNull();
    expect(qrSecondsLeft(30, now)).toBeNull();
  });
});
