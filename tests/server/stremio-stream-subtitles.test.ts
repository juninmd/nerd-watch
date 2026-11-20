import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../../src/server/db/database.ts';
import { setAddonFetch } from '../../src/server/providers/stremio/client.ts';
import { stremioRoutes } from '../../src/server/routes/stremio.ts';
import { setHostResolver } from '../../src/server/subtitles/load.ts';

/**
 * Legenda que o addon publica junto com o stream (`stream.subtitles`). O addon e o arquivo de legenda
 * são falsos; o que se prova é o contrato: o cliente pede por índice (nunca manda URL), o servidor
 * reconsulta o addon, baixa o arquivo pela barreira de host público e devolve WebVTT.
 */

const MANIFEST_URL = 'https://addon.example.com/TOKEN/manifest.json';
const BASE = 'https://addon.example.com/TOKEN';
const STREAM_URL = `${BASE}/stream/series/tt1%3A1%3A1.json`;
const SRT = '1\n00:00:01,000 --> 00:00:03,000\nOlá, mundo\n';

const manifest = { id: 'org.example.subs', name: 'Addon com legenda', version: '1.0.0', types: ['series'], resources: ['stream'], catalogs: [] };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let streams: unknown[] = [];
let subtitleRequests: string[] = [];
const originalFetch = globalThis.fetch;

const install = async (): Promise<string> => {
  const res = await stremioRoutes.request('/addons', { method: 'POST', body: JSON.stringify({ url: MANIFEST_URL }), headers: { 'content-type': 'application/json' } });
  return (await res.json()).id as string;
};

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  setHostResolver(async () => ['93.184.216.34']);
  subtitleRequests = [];
  streams = [
    {
      name: 'Brazuca',
      title: 'Episódio 1',
      infoHash: 'e5'.repeat(20),
      fileIdx: 0,
      behaviorHints: { filename: 'Ep1.mp4' },
      subtitles: [
        { id: 'pt', url: 'https://subs.example.com/pt.srt', lang: 'pt-BR' },
        { id: 'en', url: 'https://subs.example.com/en.srt', lang: 'en' },
      ],
    },
  ];
  setAddonFetch(async (url) => {
    if (url === MANIFEST_URL) return json(manifest);
    if (url === STREAM_URL) return json({ streams });
    return json({}, 404);
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    subtitleRequests.push(url);
    return new Response(SRT, { status: 200, headers: { 'content-type': 'application/x-subrip' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  setAddonFetch();
  setHostResolver();
  resetDbForTests();
  globalThis.fetch = originalFetch;
});

describe('legendas do stream do addon', () => {
  test('o DTO lista idioma e id, sem vazar a URL da legenda', async () => {
    const id = await install();
    const text = await (await stremioRoutes.request(`/addons/${id}/streams/series/${encodeURIComponent('tt1:1:1')}`)).text();
    expect(text).not.toContain('subs.example.com');
    const { streams: dto } = JSON.parse(text);
    expect(dto[0].subtitles).toEqual([
      { id: 'pt', lang: 'pt-BR' },
      { id: 'en', lang: 'en' },
    ]);
    expect(dto[0].subtitleLangs).toEqual(['pt-BR', 'en']);
  });

  test('baixa a faixa escolhida e devolve WebVTT', async () => {
    const id = await install();
    const res = await stremioRoutes.request(`/addons/${id}/subtitles/series/${encodeURIComponent('tt1:1:1')}/0/0`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/vtt');
    const body = await res.text();
    expect(body).toContain('WEBVTT');
    expect(body).toContain('Olá, mundo');
    // O servidor usou a URL que o addon respondeu agora, não algo vindo do cliente.
    expect(subtitleRequests).toEqual(['https://subs.example.com/pt.srt']);
  });

  test('índice de stream ou de faixa fora da lista é 400 e não baixa nada', async () => {
    const id = await install();
    expect((await stremioRoutes.request(`/addons/${id}/subtitles/series/${encodeURIComponent('tt1:1:1')}/9/0`)).status).toBe(400);
    expect((await stremioRoutes.request(`/addons/${id}/subtitles/series/${encodeURIComponent('tt1:1:1')}/0/9`)).status).toBe(400);
    expect((await stremioRoutes.request(`/addons/${id}/subtitles/series/${encodeURIComponent('tt1:1:1')}/x/0`)).status).toBe(400);
    expect(subtitleRequests).toEqual([]);
  });

  test('faixa com endereço privado é descartada na normalização do stream', async () => {
    streams = [{ name: 'ruim', title: 'x', url: 'https://cdn.example.com/v.mp4', subtitles: [{ id: 'x', url: 'http://127.0.0.1/a.srt', lang: 'pt' }] }];
    const id = await install();
    const { streams: dto } = await (await stremioRoutes.request(`/addons/${id}/streams/series/${encodeURIComponent('tt1:1:1')}`)).json();
    expect(dto[0].subtitles).toEqual([]);
    expect(dto[0].subtitleLangs).toEqual([]);
    expect((await stremioRoutes.request(`/addons/${id}/subtitles/series/${encodeURIComponent('tt1:1:1')}/0/0`)).status).toBe(400);
  });

  test('falha ao baixar a legenda vira 502 com mensagem fixa', async () => {
    globalThis.fetch = (async () => new Response('erro', { status: 500 })) as unknown as typeof fetch;
    const id = await install();
    const res = await stremioRoutes.request(`/addons/${id}/subtitles/series/${encodeURIComponent('tt1:1:1')}/0/0`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('a fonte não entregou a legenda');
  });
});
