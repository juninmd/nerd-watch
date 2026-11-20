import { describe, expect, test } from 'bun:test';
import { inAppUrl, MAX_START_SECONDS, parseStartTime, routeWithQuery, startSecond, withStartTime } from '../../src/client/app/deep-link.ts';

describe('parseStartTime', () => {
  test('aceita inteiro de 0 a 24 h, inclusive como texto', () => {
    expect(parseStartTime('0')).toBe(0);
    expect(parseStartTime(123)).toBe(123);
    expect(parseStartTime(String(MAX_START_SECONDS))).toBe(MAX_START_SECONDS);
  });

  test('recusa ausente, fração, negativo, texto e acima do teto', () => {
    for (const value of [null, undefined, '', '12.5', 12.5, -1, 'abc', '1e3', MAX_START_SECONDS + 1]) {
      expect(parseStartTime(value)).toBeNull();
    }
  });
});

describe('startSecond', () => {
  test('o tempo ao vivo vence, mas a posição salva mais adiante não volta; por último o t do link', () => {
    expect(startSecond(42.9, 10, 99)).toBe(42);
    expect(startSecond(42, 600, 99)).toBe(600);
    expect(startSecond(700, 600, 99)).toBe(700);
    expect(startSecond(null, 30, 99)).toBe(30);
    expect(startSecond(null, null, 99)).toBe(99);
    expect(startSecond(0, 30, 99)).toBe(30);
    expect(startSecond(0.4, 30, 99)).toBe(30);
    expect(startSecond(1.9, null, 99)).toBe(1);
  });

  test('sem nenhum ponto conhecido devolve null', () => {
    expect(startSecond(null, null, null)).toBeNull();
  });
});

describe('withStartTime', () => {
  test('acrescenta t e preserva a query que já existia', () => {
    expect(withStartTime('/watch/canal/42', 90)).toBe('/watch/canal/42?t=90');
    expect(withStartTime('/search?q=matrix', 0)).toBe('/search?q=matrix&t=0');
    expect(withStartTime('/watch/canal/42?t=10', 20)).toBe('/watch/canal/42?t=20');
  });

  test('sem posição válida não inventa query', () => {
    expect(withStartTime('/watch/canal/42')).toBe('/watch/canal/42');
    expect(withStartTime('/watch/canal/42', null)).toBe('/watch/canal/42');
  });
});

describe('inAppUrl', () => {
  test('usa a base http(s) e põe a rota depois do hash', () => {
    expect(inAppUrl('/watch/canal/42', 90, 'http://192.168.0.10:7799/')).toBe('http://192.168.0.10:7799/#/watch/canal/42?t=90');
    expect(inAppUrl('telegram/abc', null, 'https://app.example/')).toBe('https://app.example/#/telegram/abc');
  });

  test('sem base web devolve só o hash interno (desktop)', () => {
    expect(inAppUrl('/title/tmdb/movie/1', null, '')).toBe('#/title/tmdb/movie/1');
  });
});

describe('routeWithQuery', () => {
  test('junta caminho e query na mesma ordem da URL', () => {
    expect(routeWithQuery({ path: '/watch/c/1', query: new URLSearchParams('t=15') })).toBe('/watch/c/1?t=15');
    expect(routeWithQuery({ path: '/library', query: new URLSearchParams() })).toBe('/library');
  });
});
