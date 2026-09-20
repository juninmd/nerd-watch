import { describe, expect, test } from 'bun:test';
import { subtitlesRoutes } from '../src/server/routes/subtitles.ts';

describe('GET /api/subtitles (sem OPENSUBTITLES_API_KEY no ambiente de teste)', () => {
  test('devolve enabled:false sem bater na rede', async () => {
    const res = await subtitlesRoutes.request('/?query=qualquer+coisa');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: false, results: [] });
  });
});

describe('POST /api/subtitles/download', () => {
  test('501 quando o provider não está configurado', async () => {
    const res = await subtitlesRoutes.request('/download', { method: 'POST', body: JSON.stringify({ fileId: 1 }) });
    expect(res.status).toBe(501);
  });
});
