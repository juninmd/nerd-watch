import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { tvmazeRoutes } from '../../src/server/routes/tvmaze.ts';
import { resetTvmazeRateLimitForTests } from '../../src/server/providers/tvmaze.ts';

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PERSON = { id: 5, name: 'Ator Fake', image: { medium: 'https://static.example.test/p.jpg' }, country: { name: 'Brazil' }, birthday: '1980-02-03' };

beforeEach(() => resetTvmazeRateLimitForTests());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /api/tvmaze/:id/more', () => {
  test('pede todos os embeds em embed[] e normaliza elenco, equipe, galeria, canais e ids', async () => {
    const seen: URL[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(new URL(String(input)));
      return json({
        id: 8801, type: 'Scripted', language: 'English', genres: ['Drama'], status: 'Running', averageRuntime: 45, weight: 77,
        schedule: { time: '21:00', days: ['Sunday'] },
        network: { name: 'HBO', country: { name: 'United States' }, officialSite: 'https://www.hbo.com/' },
        webChannel: { name: 'Max', officialSite: 'javascript:alert(1)' },
        externals: { imdb: 'tt0944947', thetvdb: 121361, tvrage: null },
        _embedded: {
          cast: [{ person: PERSON, character: { name: 'Heroína', image: null }, voice: true, self: false }, { person: null }],
          crew: [{ type: 'Creator', person: PERSON }],
          akas: [{ name: 'Taht', country: { name: 'Turkey' } }],
          images: [{ type: 'poster', main: true, resolutions: { original: { url: 'https://static.example.test/o.jpg', width: 680, height: 1000 }, medium: { url: 'https://static.example.test/m.jpg' } } }, { type: 'x', resolutions: { original: { url: 'http://insecure.test/a.jpg' } } }],
          seasons: [{ number: 1, name: '', episodeOrder: 10, premiereDate: '2011-04-17', endDate: '2011-06-19', network: { name: 'HBO' }, summary: '<p>Resumo</p>' }],
          episodes: [{ id: 1, season: 1, number: 1, name: 'Piloto', airdate: '2011-04-17', rating: { average: 8.4 }, runtime: 60, type: 'regular' }],
          nextepisode: { id: 2, season: 2, number: 1, name: 'Volta', airdate: '2026-12-01', airstamp: '2026-12-01T21:00:00-05:00' },
          previousepisode: [],
        },
      });
    }) as unknown as typeof fetch;

    const body = await (await tvmazeRoutes.request('/8801/more')).json();
    expect(seen[0]?.searchParams.getAll('embed[]')).toEqual(['cast', 'crew', 'akas', 'images', 'seasons', 'episodes', 'nextepisode', 'previousepisode']);
    expect(body.cast).toHaveLength(1);
    expect(body.cast[0]).toMatchObject({ voice: true, character: { name: 'Heroína' }, person: { id: 5, country: 'Brazil' } });
    expect(body.crew[0].role).toBe('Creator');
    expect(body.images).toEqual([{ type: 'poster', main: true, url: 'https://static.example.test/o.jpg', thumbUrl: 'https://static.example.test/m.jpg', width: 680, height: 1000 }]);
    expect(body.channels.map((c: { name: string; url: string | null }) => [c.name, c.url])).toEqual([['Max', null], ['HBO', 'https://www.hbo.com/']]);
    expect(body.externals).toEqual({ imdb: 'tt0944947', thetvdb: 121361, tvrage: null });
    expect(body.nextEpisode).toMatchObject({ season: 2, number: 1 });
    expect(body.previousEpisode).toBeNull();
    expect(body.runtimeMinutes).toBe(45);
    expect(body.seasons[0]).toMatchObject({ number: 1, name: null, summary: 'Resumo', channel: 'HBO' });
  });

  test('id inválido é 400 e série inexistente é 404', async () => {
    expect((await tvmazeRoutes.request('/abc/more')).status).toBe(400);
    globalThis.fetch = (async () => new Response('x', { status: 404 })) as unknown as typeof fetch;
    expect((await tvmazeRoutes.request('/8802/more')).status).toBe(404);
  });
});

describe('pessoas', () => {
  test('/person/:id agrupa créditos pelos links do show, sem chamadas extras', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return json({
        ...PERSON,
        url: 'https://www.tvmaze.com/people/5/ator-fake',
        _embedded: {
          castcredits: [{ voice: false, _links: { show: { href: 'https://api.tvmaze.com/shows/1', name: 'Série Um' }, character: { name: 'Herói' } } }],
          crewcredits: [{ type: 'Producer', _links: { show: { href: 'https://api.tvmaze.com/shows/2', name: 'Série Dois' } } }, { type: 'x', _links: {} }],
        },
      });
    }) as unknown as typeof fetch;
    const body = await (await tvmazeRoutes.request('/person/5')).json();
    expect(calls).toBe(1);
    expect(body.cast).toEqual([{ showId: 1, showName: 'Série Um', role: 'Herói', voice: false }]);
    expect(body.crew).toEqual([{ showId: 2, showName: 'Série Dois', role: 'Producer', voice: false }]);
    expect(body.birthday).toBe('1980-02-03');
  });

  test('/people/search exige q e mapeia pessoas', async () => {
    expect((await tvmazeRoutes.request('/people/search')).status).toBe(400);
    globalThis.fetch = (async () => json([{ score: 1, person: PERSON }, { score: 0.1, person: { id: 'x' } }])) as unknown as typeof fetch;
    const body = await (await tvmazeRoutes.request('/people/search?q=ator-fake-8803')).json();
    expect(body.results.map((p: { id: number }) => p.id)).toEqual([5]);
  });
});
