import { describe, expect, test } from 'bun:test';
import { hostAllowed, originAllowed, requestAllowed } from '../src/server/security.ts';

describe('hostAllowed', () => {
  test('aceita loopback com e sem porta', () => {
    expect(hostAllowed('127.0.0.1:7799')).toBe(true);
    expect(hostAllowed('localhost')).toBe(true);
    expect(hostAllowed('[::1]:7799')).toBe(true);
  });

  test('rejeita host de DNS rebinding', () => {
    expect(hostAllowed('evil.example.com')).toBe(false);
    expect(hostAllowed('127.0.0.1.evil.com')).toBe(false);
  });

  test('sem header Host passa (curl/mesma origem)', () => {
    expect(hostAllowed('')).toBe(true);
  });
});

describe('originAllowed', () => {
  test('aceita origem loopback http', () => {
    expect(originAllowed('http://127.0.0.1:7799')).toBe(true);
    expect(originAllowed('http://localhost:7799')).toBe(true);
  });

  test('rejeita origem externa (CSRF)', () => {
    expect(originAllowed('https://evil.example.com')).toBe(false);
  });

  test('sem header Origin passa', () => {
    expect(originAllowed('')).toBe(true);
  });
});

describe('requestAllowed', () => {
  test('GET com origem externa passa (idempotente, sem risco de CSRF)', () => {
    expect(requestAllowed('GET', '127.0.0.1:7799', 'https://evil.example.com')).toBe(true);
  });

  test('POST com origem externa bloqueia', () => {
    expect(requestAllowed('POST', '127.0.0.1:7799', 'https://evil.example.com')).toBe(false);
  });

  test('POST com host de rebinding bloqueia mesmo com origem correta', () => {
    expect(requestAllowed('POST', 'evil.com', 'http://127.0.0.1:7799')).toBe(false);
  });

  test('POST loopback -> loopback passa', () => {
    expect(requestAllowed('POST', '127.0.0.1:7799', 'http://127.0.0.1:7799')).toBe(true);
  });
});
