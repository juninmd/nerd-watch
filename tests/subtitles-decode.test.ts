import { describe, expect, test } from 'bun:test';
import { decodeSubtitleBytes } from '../src/shared/subtitles/decode.ts';

/** Legenda antiga de pt-BR costuma vir em Windows-1252: sem isso "café" vira "caf�". */
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf16le = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length * 2 + 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
};

describe('decodeSubtitleBytes', () => {
  test.each([
    ['UTF-8 puro com acento', bytes(0x63, 0x61, 0x66, 0xc3, 0xa9), 'café'],
    ['UTF-8 com BOM (BOM sai do texto)', bytes(0xef, 0xbb, 0xbf, 0x4f, 0x69), 'Oi'],
    ['Windows-1252 com é (0xE9) e € (0x80)', bytes(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80), 'café €'],
    ['Latin-1 com ç e ã (0xE7, 0xE3), que não é UTF-8 válido', bytes(0x61, 0xe7, 0xe3, 0x6f), 'ação'],
    ['vazio', bytes(), ''],
  ])('%s', (_label, input, expected) => {
    expect(decodeSubtitleBytes(input)).toBe(expected);
  });

  test('UTF-8 multibyte não é confundido com Windows-1252 (ç = C3 A7 em UTF-8)', () => {
    expect(decodeSubtitleBytes(bytes(0xc3, 0xa7))).toBe('ç');
  });

  test('UTF-16 LE com BOM', () => {
    expect(decodeSubtitleBytes(utf16le('Olá'))).toBe('Olá');
  });

  test('UTF-16 BE com BOM', () => {
    const le = utf16le('ok');
    const be = new Uint8Array(le.length);
    be[0] = 0xfe;
    be[1] = 0xff;
    for (let i = 2; i < le.length; i += 2) {
      be[i] = le[i + 1] ?? 0;
      be[i + 1] = le[i] ?? 0;
    }
    expect(decodeSubtitleBytes(be)).toBe('ok');
  });

  test('um byte solto só não quebra o arquivo inteiro (cai para Windows-1252)', () => {
    expect(decodeSubtitleBytes(bytes(0x41, 0xff, 0x42))).toBe('AÿB');
  });
});
