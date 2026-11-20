import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveFile } from '../../src/server/providers/local/range.ts';
import { readTextLimited } from '../../src/server/providers/sources/http.ts';
import { parseCalendarDays } from '../../src/server/routes/calendar.ts';

describe('readTextLimited', () => {
  test('cancela o stream quando Content-Length ultrapassa o teto', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const res = new Response(stream, { headers: { 'content-length': '99999' } });
    await expect(readTextLimited(res, 100)).rejects.toThrow(/grande demais/);
    expect(cancelled).toBe(true);
  });
});

describe('serveFile (HEAD)', () => {
  test('HEAD responde cabeçalhos e tamanho sem enviar corpo (200 e 206)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-range-head-'));
    const file = join(dir, 'sample.mp4');
    try {
      writeFileSync(file, '0123456789');
      const full = await serveFile(file, undefined, 'HEAD');
      expect(full.status).toBe(200);
      expect(full.headers.get('Content-Length')).toBe('10');
      expect(full.body).toBeNull();

      const partial = await serveFile(file, 'bytes=2-5', 'HEAD');
      expect(partial.status).toBe(206);
      expect(partial.headers.get('Content-Range')).toBe('bytes 2-5/10');
      expect(partial.headers.get('Content-Length')).toBe('4');
      expect(partial.body).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseCalendarDays', () => {
  test('aceita inteiros de 1 a 365 e rejeita fracionários ou fora da faixa', () => {
    expect(parseCalendarDays('30')).toBe(30);
    expect(parseCalendarDays('1')).toBe(1);
    expect(parseCalendarDays('365')).toBe(365);
    expect(parseCalendarDays('1.5')).toBe(60);
    expect(parseCalendarDays('0')).toBe(60);
    expect(parseCalendarDays('-5')).toBe(60);
    expect(parseCalendarDays('366')).toBe(60);
    expect(parseCalendarDays(undefined)).toBe(60);
  });
});
