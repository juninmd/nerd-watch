import { describe, expect, test } from 'bun:test';
import { ValidationError } from '../../src/server/lib/validation-error.ts';
import { parseAddonUrl } from '../../src/server/providers/stremio/url.ts';

describe('parseAddonUrl', () => {
  test('aceita https e converte stremio://', () => {
    expect(parseAddonUrl('https://addon.example.com/manifest.json')).toEqual({
      manifestUrl: 'https://addon.example.com/manifest.json',
      baseUrl: 'https://addon.example.com',
      host: 'addon.example.com',
    });
    expect(parseAddonUrl(' stremio://addon.example.com/abc/manifest.json ').baseUrl).toBe('https://addon.example.com/abc');
  });

  test('recusa o que não é link de manifest público', () => {
    const bad = [
      '',
      'texto solto',
      'ftp://addon.example.com/manifest.json',
      'https://addon.example.com/outro.json',
      'https://user:pass@addon.example.com/manifest.json',
      'http://localhost:7000/manifest.json',
      'http://127.0.0.1/manifest.json',
      'http://192.168.0.10/manifest.json',
      'https://intranet/manifest.json',
      'https://addon.example.com/manifest.json?config=segredo',
      `https://addon.example.com/${'a'.repeat(3000)}/manifest.json`,
    ];
    for (const raw of bad) expect(() => parseAddonUrl(raw)).toThrow(ValidationError);
    expect(() => parseAddonUrl(42)).toThrow(ValidationError);
  });
});
