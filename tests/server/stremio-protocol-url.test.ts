import { describe, expect, test } from 'bun:test';
import { safeHttpUrl } from '../../src/server/providers/stremio/protocol.ts';

describe('safeHttpUrl (protocolo Stremio)', () => {
  test('aceita URLs públicas http(s)', () => {
    expect(safeHttpUrl('https://cdn.example.com/movie.mp4')).toBe('https://cdn.example.com/movie.mp4');
    expect(safeHttpUrl('http://img.example.com/poster.jpg')).toBe('http://img.example.com/poster.jpg');
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'https://user:pass@cdn.example.com/a.mp4',
    'http://127.0.0.1:7799/api/backup',
    'http://localhost:7799/api/credentials',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/admin',
    'https://cdn.example.com/a\nb.mp4',
  ])('rejeita %s', (raw) => {
    expect(safeHttpUrl(raw)).toBeNull();
  });
});
