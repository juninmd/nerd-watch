import { afterEach, describe, expect, test } from 'bun:test';
import { setSkipTimesFetchForTests } from '../../src/server/providers/skip-times/index.ts';
import { parseAniSkip, parseIntroDb } from '../../src/server/providers/skip-times/parse.ts';
import { skipTimesRoutes } from '../../src/server/routes/skip-times.ts';

// Formato real das duas APIs (capturado em 2026-11-28), reduzido.
const INTRODB = {
  imdb_id: 'tt0903747',
  intro: { start_sec: 50, end_sec: 110 },
  recap: null,
  outro: { start_sec: 3431, end_sec: 3500 },
  post_credits: null,
};
const ANISKIP = {
  found: true,
  results: [
    { interval: { startTime: 28.7, endTime: 118.7 }, skipType: 'op', episodeLength: 1500 },
    { interval: { startTime: 186, endTime: 276 }, skipType: 'mixed-op', episodeLength: 1440 },
    { interval: { startTime: 1388, endTime: 1500 }, skipType: 'ed', episodeLength: 1500 },
    { interval: { startTime: 10, endTime: 5 }, skipType: 'recap', episodeLength: 1500 },
  ],
};

describe('trechos de pular', () => {
  test('IntroDB: abertura e créditos em segundos; campos nulos somem', () => {
    expect(parseIntroDb(INTRODB)).toEqual([
      { kind: 'intro', start: 50, end: 110 },
      { kind: 'credits', start: 3431, end: 3500 },
    ]);
    expect(parseIntroDb(null)).toEqual([]);
  });

  test('AniSkip: por tipo, o envio com duração mais próxima do vídeo; intervalo invertido é descartado', () => {
    expect(parseAniSkip(ANISKIP, 1441)).toEqual([
      { kind: 'intro', start: 186, end: 276 },
      { kind: 'credits', start: 1388, end: 1500 },
    ]);
    expect(parseAniSkip(ANISKIP, null)[0]).toEqual({ kind: 'intro', start: 28.7, end: 118.7 });
    expect(parseAniSkip({ results: 'x' }, null)).toEqual([]);
  });
});

describe('GET /api/skip-times', () => {
  afterEach(() => setSkipTimesFetchForTests());

  test('responde os trechos do IntroDB sem sair para a rede nos testes', async () => {
    const asked: string[] = [];
    setSkipTimesFetchForTests(async (url) => {
      asked.push(String(url));
      return new Response(JSON.stringify(INTRODB), { status: 200 });
    });
    const res = await skipTimesRoutes.request('/?imdbId=tt0903747&season=1&episode=1');
    expect(res.status).toBe(200);
    expect((await res.json()).segments).toHaveLength(2);
    expect(asked[0]).toBe('https://api.introdb.app/segments?imdb_id=tt0903747&season=1&episode=1');
  });

  test('valida a entrada antes de qualquer chamada externa', async () => {
    expect((await skipTimesRoutes.request('/')).status).toBe(400);
    expect((await skipTimesRoutes.request('/?imdbId=../etc')).status).toBe(400);
    expect((await skipTimesRoutes.request('/?imdbId=tt0903747&season=-1')).status).toBe(400);
  });
});
