import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { tvmazeRoutes } from '../../src/server/routes/tvmaze.ts';
import { resetTvmazeRateLimitForTests } from '../../src/server/providers/tvmaze.ts';
import { resetWikipediaRateLimitForTests } from '../../src/server/providers/wikipedia-bio.ts';

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const credit = (id: number, name: string, weight: number, character: string) => ({
  voice: false,
  _embedded: { show: { id, name, premiered: '2016-09-19', image: { medium: `https://static.tvmaze.com/${id}.jpg` }, rating: { average: 6.5 }, weight }, character: { name: character } },
});

/** Responde TVmaze (pessoa e créditos) e Wikipédia pelo caminho pedido; `wiki` decide o resumo. */
const fakeApis = (personId: number, name: string, wiki: () => Response) =>
  (async (url: string) => {
    const u = new URL(url);
    if (u.host.endsWith('wikipedia.org')) return wiki();
    if (u.pathname === `/people/${personId}/castcredits`) return json([credit(17127, 'Kevin Can Wait', 80, 'Kevin Gable'), credit(1, 'Show Menor', 10, 'X'), credit(17127, 'Kevin Can Wait', 80, 'Repetido')]);
    if (u.pathname === `/people/${personId}`) return json({ id: personId, name, birthday: '1965-04-26', url: 'https://www.tvmaze.com/people/1/x', _embedded: { castcredits: [] } });
    return json({}, 404);
  }) as unknown as typeof fetch;

beforeEach(() => {
  resetTvmazeRateLimitForTests();
  resetWikipediaRateLimitForTests();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /api/tvmaze/person/:id/card', () => {
  test('junta séries com pôster (sem repetir, mais populares primeiro) e a mini bio', async () => {
    globalThis.fetch = fakeApis(29997, 'Pessoa Com Bio Rota', () => json({ type: 'standard', extract: 'Kevin James é um ator e comediante americano.', content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Kevin_James' } } }));
    const res = await tvmazeRoutes.request('/person/29997/card');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.person.name).toBe('Pessoa Com Bio Rota');
    expect(body.shows.map((s: { name: string }) => s.name)).toEqual(['Kevin Can Wait', 'Show Menor']);
    expect(body.shows[0]).toMatchObject({ showId: 17127, year: '2016', role: 'Kevin Gable', posterUrl: 'https://static.tvmaze.com/17127.jpg' });
    expect(body.bio).toEqual({ extract: 'Kevin James é um ator e comediante americano.', url: 'https://pt.wikipedia.org/wiki/Kevin_James', lang: 'pt' });
    expect(body.attribution.name).toBe('TVmaze');
  });

  test('Wikipédia fora do ar não derruba o cartão: bio vem nula', async () => {
    // Nome próprio do teste: o cache de bio é por nome e não pode vir de outro teste.
    globalThis.fetch = fakeApis(41572, 'Pessoa Sem Bio Rota', () => json({}, 503));
    const res = await tvmazeRoutes.request('/person/41572/card');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bio).toBeNull();
    expect(body.shows).toHaveLength(2);
  });

  test('id inválido é recusado antes de qualquer chamada', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;
    expect((await tvmazeRoutes.request('/person/abc/card')).status).toBe(400);
    expect(called).toBe(false);
  });
});
