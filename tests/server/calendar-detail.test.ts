import { afterEach, describe, expect, mock, setSystemTime, test } from 'bun:test';
import { calendarRoutes } from '../../src/server/routes/calendar.ts';
import { resetAnilistRateLimitForTests } from '../../src/server/providers/anilist.ts';
import { resetTvmazeRateLimitForTests } from '../../src/server/providers/tvmaze.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetAnilistRateLimitForTests();
  resetTvmazeRateLimitForTests();
});

const show = {
  id: 9001,
  name: 'Série <b>Teste</b>',
  url: 'https://www.tvmaze.com/shows/9001/teste',
  officialSite: 'https://www.exemplo.com/teste',
  summary: '<p>Uma <b>sinopse</b>.</p>',
  rating: { average: 8.2 },
  genres: ['Drama'],
  type: 'Scripted',
  language: 'English',
  premiered: '2026-11-20',
  webChannel: { name: 'Max', officialSite: 'https://www.max.com/' },
  externals: { imdb: 'tt1234567' },
};

describe('GET /api/calendar/detail', () => {
  test('rejeita fonte desconhecida e id fora do formato sem tocar a rede', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('rede não deveria ser chamada');
    }) as unknown as typeof fetch;
    expect((await calendarRoutes.request('/detail?source=x&id=1')).status).toBe(400);
    expect((await calendarRoutes.request('/detail?source=tvmaze&id=1;drop')).status).toBe(400);
  });

  test('TVmaze: streaming vem do webChannel, sinopse sem HTML e links https', async () => {
    globalThis.fetch = mock(async () => Response.json(show)) as unknown as typeof fetch;
    const res = await calendarRoutes.request('/detail?source=tvmaze&id=9001&media=tv');
    const { info } = await res.json();
    expect(res.status).toBe(200);
    expect(info.origin).toBe('serie');
    expect(info.where).toBe('stream');
    expect(info.providers).toEqual([{ name: 'Max', url: 'https://www.max.com/' }]);
    expect(info.synopsis).toBe('Uma sinopse.');
    expect(info.trailerSearchUrl).toContain('youtube.com/results');
  });

  test('AniList: trailer só YouTube válido e streaming vem dos links externos', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        data: {
          Media: {
            id: 5,
            title: { romaji: 'Anime X' },
            siteUrl: 'https://anilist.co/anime/5',
            averageScore: 82,
            trailer: { id: 'abc123XYZ_-', site: 'youtube' },
            externalLinks: [
              { site: 'Crunchyroll', url: 'https://www.crunchyroll.com/x', type: 'STREAMING' },
              { site: 'Twitter', url: 'https://x.com/a', type: 'SOCIAL' },
            ],
          },
        },
      }),
    ) as unknown as typeof fetch;
    const { info } = await (await calendarRoutes.request('/detail?source=anilist&id=5')).json();
    expect(info.origin).toBe('anime');
    expect(info.where).toBe('stream');
    expect(info.providers.map((p: { name: string }) => p.name)).toEqual(['Crunchyroll']);
    expect(info.trailerKey).toBe('abc123XYZ_-');
    expect(info.rating).toBe(8.2);
  });

  test('falha da fonte vira erro com a mensagem nossa, não o corpo cru', async () => {
    globalThis.fetch = mock(async () => new Response('segredo interno', { status: 500 })) as unknown as typeof fetch;
    const res = await calendarRoutes.request('/detail?source=tvmaze&id=77');
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('segredo');
  });
});

describe('GET /api/calendar/discover com ficha', () => {
  // tvmazeWebPremieres is cached per date for the whole process; a date no other test uses keeps test order from mattering.
  afterEach(() => setSystemTime());

  test('estreia da TVmaze já traz onde assistir e origem', async () => {
    setSystemTime(new Date('2031-03-14T12:00:00'));
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input).includes('/schedule/web')) return Response.json([{ name: 'Piloto', season: 1, number: 1, _embedded: { show } }]);
      return new Response('x', { status: 500 });
    }) as unknown as typeof fetch;
    const body = await (await calendarRoutes.request('/discover?days=0.1')).json();
    const entry = body.entries.find((e: { titleSource: string }) => e.titleSource === 'tvmaze');
    expect(entry.info.where).toBe('stream');
    expect(entry.info.providers[0].name).toBe('Max');
    expect(entry.info.rating).toBe(8.2);
  });
});
