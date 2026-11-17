import { afterEach, describe, expect, mock, test } from 'bun:test';
import { calendarRoutes } from '../../src/server/routes/calendar.ts';
import { resetAnilistRateLimitForTests } from '../../src/server/providers/anilist.ts';
import { resetTvmazeRateLimitForTests } from '../../src/server/providers/tvmaze.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetAnilistRateLimitForTests();
  resetTvmazeRateLimitForTests();
});

describe('GET /api/calendar/discover', () => {
  test('junta estreias de streaming e anime; informa fonte que falhou', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.tvmaze.com/schedule/web')) {
        const date = new URL(url).searchParams.get('date');
        return Response.json([
          { name: 'Piloto', season: 1, number: 1, _embedded: { show: { id: 7, name: `Série ${date}`, image: null } } },
          { name: 'Meio', season: 1, number: 4, _embedded: { show: { id: 8, name: 'Ignorada' } } },
        ]);
      }
      return new Response('x', { status: 500 });
    }) as unknown as typeof fetch;

    const res = await calendarRoutes.request('/discover?days=1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.failed).toContain('AniList');
    expect(body.entries.length).toBe(2);
    expect(body.entries.every((e: { titleSource: string; episodeNumber: number }) => e.titleSource === 'tvmaze' && e.episodeNumber === 1)).toBe(true);
  });
});
