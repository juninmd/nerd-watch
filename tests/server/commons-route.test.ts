import { afterEach, describe, expect, test } from 'bun:test';
import { commonsRoutes } from '../../src/server/routes/commons.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const page = (title: string, mime: string, extra: Record<string, unknown> = {}) => ({
  title,
  imageinfo: [
    {
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${title.slice(5)}`,
      thumburl: 'https://upload.wikimedia.org/thumb.jpg',
      descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
      mime,
      extmetadata: { LicenseShortName: { value: 'CC BY 3.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/3.0' }, Artist: { value: '<a href="x">Blender Foundation</a>' }, ImageDescription: { value: '<p>Um &amp; outro</p>' } },
      ...extra,
    },
  ],
});

const mock = (pages: unknown[], calls: string[] = []) => {
  globalThis.fetch = (async (url: URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ query: { pages } }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
};

describe('GET /api/commons/search', () => {
  test('mapeia só vídeos, com licença e autor sem HTML', async () => {
    const calls: string[] = [];
    mock([page('File:Big_Buck_Bunny.webm', 'video/webm'), page('File:Foto.jpg', 'image/jpeg')], calls);
    const res = await commonsRoutes.request('/search?q=bunny-teste-a');
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Big Buck Bunny', license: 'CC BY 3.0', author: 'Blender Foundation', description: 'Um & outro' });
    expect(calls[0]).toContain('filetype%3Avideo');
  });

  test('neutraliza sintaxe de busca do termo', async () => {
    const calls: string[] = [];
    mock([], calls);
    await commonsRoutes.request(`/search?q=${encodeURIComponent('a" incategory:X | b')}`);
    const q = new URL(calls[0] as string).searchParams.get('gsrsearch');
    expect(q).toBe('a incategory X b filetype:video');
  });

  test('descarta arquivo hospedado fora do domínio da Wikimedia', async () => {
    mock([page('File:X.webm', 'video/webm', { url: 'https://evil.example.com/x.webm' })]);
    const { results } = await (await commonsRoutes.request('/search?q=fora-dominio-teste')).json();
    expect(results).toHaveLength(0);
  });

  test('502 quando a Wikimedia falha', async () => {
    globalThis.fetch = (async () => new Response('x', { status: 429 })) as unknown as typeof fetch;
    expect((await commonsRoutes.request('/search?q=falha-teste')).status).toBe(502);
  });

  test('400 para consulta longa demais ou com caractere de controle, sem tocar a rede', async () => {
    const calls: string[] = [];
    mock([], calls);
    expect((await commonsRoutes.request(`/search?q=${'a'.repeat(201)}`)).status).toBe(400);
    expect((await commonsRoutes.request('/search?q=x%00y')).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/commons/file', () => {
  test('exige título File: válido', async () => {
    for (const t of ['', 'Foto.jpg', 'File:a|b']) expect((await commonsRoutes.request(`/file?title=${encodeURIComponent(t)}`)).status).toBe(400);
  });

  test('devolve o vídeo; 404 quando não é vídeo', async () => {
    mock([page('File:Sintel.webm', 'video/webm')]);
    const ok = await commonsRoutes.request('/file?title=File:Sintel.webm');
    expect(ok.status).toBe(200);
    expect((await ok.json()).videoUrl).toContain('upload.wikimedia.org');
    mock([page('File:Foto2.jpg', 'image/jpeg')]);
    expect((await commonsRoutes.request('/file?title=File:Foto2.jpg')).status).toBe(404);
  });
});
