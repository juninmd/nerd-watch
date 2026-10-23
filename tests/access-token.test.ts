import { describe, expect, test } from 'bun:test';
import {
  ACCESS_TOKEN_MIN_LENGTH,
  AccessTokenError,
  isApiPath,
  isPublicPath,
  isSecureRequest,
  parseAccessToken,
  safeEqual,
  sessionValue,
} from '../src/server/access.ts';

// Token falso: só existe neste arquivo de teste.
const TOKEN = 'fake-token-0123456789';

describe('parseAccessToken', () => {
  test('sem ACCESS_TOKEN (ou só espaços) o app segue local-first, sem exigir nada', () => {
    expect(parseAccessToken(undefined)).toBeUndefined();
    expect(parseAccessToken('')).toBeUndefined();
    expect(parseAccessToken('   ')).toBeUndefined();
  });

  test('aceita 16 caracteres ou mais e apara espaços das pontas', () => {
    expect(ACCESS_TOKEN_MIN_LENGTH).toBe(16);
    expect(parseAccessToken('0123456789abcdef')).toBe('0123456789abcdef');
    expect(parseAccessToken('  0123456789abcdef  ')).toBe('0123456789abcdef');
  });

  test('recusa token curto e não ecoa o valor na mensagem', () => {
    const short = 'curto-falso-123'; // 15 caracteres
    let caught: unknown;
    try {
      parseAccessToken(short);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AccessTokenError);
    expect((caught as Error).message).toContain('16');
    expect((caught as Error).message).not.toContain(short);
  });

  test('o limite conta depois de aparar espaços (15 úteis + espaços continuam curtos)', () => {
    expect(() => parseAccessToken('   0123456789abcde   ')).toThrow(AccessTokenError);
  });
});

describe('safeEqual', () => {
  test('iguais passam e diferentes falham', () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true);
    expect(safeEqual(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(safeEqual(TOKEN, 'fake-token-0123456780')).toBe(false);
  });

  test('tamanhos diferentes são falsos sem lançar exceção (digests de mesmo tamanho)', () => {
    expect(() => safeEqual('abc', 'abcd')).not.toThrow();
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', TOKEN)).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('sessionValue', () => {
  const GEN = 'fake-generation-aaaa';

  test('é derivado por HMAC: determinístico, muda com token ou geração e não contém o token', () => {
    const value = sessionValue(TOKEN, GEN);
    expect(value).toBe(sessionValue(TOKEN, GEN));
    expect(value).not.toBe(sessionValue(`${TOKEN}x`, GEN));
    expect(value).not.toBe(sessionValue(TOKEN, 'fake-generation-bbbb'));
    expect(value).not.toContain(TOKEN);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/); // cabe em cookie sem escape
  });
});

describe('isPublicPath', () => {
  test('a allowlist pública é mínima: health, login/logout e o front estático', () => {
    expect(isPublicPath('GET', '/api/health', '/api/health')).toBe(true);
    expect(isPublicPath('GET', '/login', '/login')).toBe(true);
    expect(isPublicPath('POST', '/login', '/login')).toBe(true);
    expect(isPublicPath('POST', '/logout', '/logout')).toBe(true);
    expect(isPublicPath('GET', '/', '/')).toBe(true);
    expect(isPublicPath('GET', '/main.js', '/main.js')).toBe(true);
  });

  test('qualquer outra rota /api é protegida, inclusive variações de caixa, barra final e escrita no health', () => {
    expect(isPublicPath('POST', '/api/health', '/api/health')).toBe(false);
    expect(isPublicPath('GET', '/api/health/', '/api/health/')).toBe(false);
    expect(isPublicPath('GET', '/api/search', '/api/search')).toBe(false);
    expect(isPublicPath('GET', '/API/search', '/API/search')).toBe(false);
    expect(isPublicPath('GET', '/api', '/api')).toBe(false);
  });

  test('caminho codificado que aponta para /api continua protegido (Hono decodifica antes de rotear)', () => {
    expect(isPublicPath('GET', '/%61pi/search', '/api/search')).toBe(false);
    expect(isApiPath('/api/x')).toBe(true);
    expect(isApiPath('/apple.png')).toBe(false);
  });
});

describe('isSecureRequest', () => {
  test('http sem proxy confiável não marca Secure', () => {
    expect(isSecureRequest('http://nerd.test/login', undefined, false)).toBe(false);
  });

  test('https marca Secure mesmo sem proxy', () => {
    expect(isSecureRequest('https://nerd.test/login', undefined, false)).toBe(true);
  });

  test('X-Forwarded-Proto só vale com ACCESS_TRUST_PROXY ligado', () => {
    expect(isSecureRequest('http://nerd.test/login', 'https', false)).toBe(false);
    expect(isSecureRequest('http://nerd.test/login', 'https', true)).toBe(true);
    expect(isSecureRequest('http://nerd.test/login', 'http', true)).toBe(false);
    expect(isSecureRequest('http://nerd.test/login', 'https, http', true)).toBe(true);
  });
});
