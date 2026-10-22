import { describe, expect, test } from 'bun:test';
import { isPrivateHandle, parseTelegramRef, privateChannelId } from '../src/server/providers/telegram/ref.ts';

const privateRef = { handle: 'c/2675951342', private: true };

describe('parseTelegramRef — canal ou grupo privado', () => {
  test.each([
    ['https://t.me/c/2675951342/7', 'link de mensagem'],
    ['t.me/c/2675951342/7', 'sem esquema'],
    ['https://t.me/c/2675951342/5/7', 'mensagem dentro de um tópico de fórum'],
    ['https://t.me/c/2675951342', 'sem número de mensagem'],
    ['https://t.me/c/2675951342/7?single', 'com query'],
    ['https://telegram.me/c/2675951342/7', 'domínio alternativo'],
    ['tg://privatepost?channel=2675951342&post=7', 'link de app'],
    ['-1002675951342', 'id no formato da Bot API'],
    ['c/2675951342', 'forma canônica'],
    ['2675951342', 'só o número'],
    ['  https://t.me/c/2675951342/7  ', 'espaços nas pontas'],
  ])('%s (%s)', (input) => {
    expect(parseTelegramRef(input)).toEqual(privateRef);
  });

  test('recusa ids que não são de canal', () => {
    for (const bad of ['https://t.me/c/0/7', 'https://t.me/c/abc/7', 'https://t.me/c/', 'c/-5', '12345678901234567', 'https://t.me/c/00123/4']) {
      expect(parseTelegramRef(bad)).toBeNull();
    }
  });
});

describe('parseTelegramRef — canal público', () => {
  test.each([
    ['@cine_ch', 'cine_ch'],
    ['cine_ch', 'cine_ch'],
    ['https://t.me/cine_ch', 'cine_ch'],
    ['https://t.me/cine_ch/123', 'cine_ch'],
    ['https://t.me/s/cine_ch', 'cine_ch'],
    ['http://www.t.me/cine_ch', 'cine_ch'],
  ])('%s', (input, handle) => {
    expect(parseTelegramRef(input)).toEqual({ handle, private: false });
  });

  test('recusa convite, host estranho e lixo', () => {
    for (const bad of ['', '   ', 'a', 'https://t.me/+AbCdEf123', 'https://t.me/joinchat/AbCdEf', 'https://evil.example/c/2675951342/7', 'https://t.me.evil.example/cine_ch', 'cine ch', 'tg://resolve?domain=cine_ch']) {
      expect(parseTelegramRef(bad)).toBeNull();
    }
  });
});

describe('handle privado', () => {
  test('isPrivateHandle / privateChannelId só aceitam a forma canônica', () => {
    expect(isPrivateHandle('c/2675951342')).toBe(true);
    expect(privateChannelId('c/2675951342')).toBe('2675951342');
    for (const other of ['cine_ch', 'c/', 'c/abc', 'c/0', 'x/2675951342', '']) {
      expect(isPrivateHandle(other)).toBe(false);
      expect(privateChannelId(other)).toBeNull();
    }
  });
});
