import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { calendarRoutes } from '../src/server/routes/calendar.ts';
import { tvmazeRoutes } from '../src/server/routes/tvmaze.ts';
import { todayIso } from '../src/server/date.ts';
import { resetTvmazeRateLimitForTests } from '../src/server/providers/tvmaze.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const tomorrow = (): string => todayIso(new Date(Date.now() + 86_400_000));

/** Série sintética: dois episódios com data (um amanhã, para aparecer no calendário) e um especial sem número. */
const showWith = (id: number) => ({
  id,
  name: 'Série Rota',
  status: 'Running',
  premiered: '2026-01-01',
  ended: null,
  summary: '<p>Sinopse &amp; mais.</p>',
  image: { medium: 'https://static.example.test/rota.jpg' },
  rating: { average: 7.1 },
  url: 'https://www.tvmaze.com/shows/1/x',
  officialSite: null,
  _embedded: {
    episodes: [
      { id: 1, name: 'Piloto', season: 1, number: 1, airdate: '2026-01-01', runtime: 45, summary: '<p>Ini.</p>', image: null },
      { id: 2, name: 'Próximo', season: 1, number: 2, airdate: tomorrow(), runtime: 45, summary: null, image: null },
      { id: 3, name: 'Especial', season: 0, number: null, airdate: '2026-02-01', runtime: null, summary: null, image: null },
    ],
  },
});

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  resetTvmazeRateLimitForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /api/tvmaze/:id', () => {
  test('grava o título e temporadas/episódios que o calendário lê, e devolve atribuição', async () => {
    globalThis.fetch = (async () => json(showWith(9101))) as unknown as typeof fetch;

    const res = await tvmazeRoutes.request('/9101');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Série Rota');
    expect(body.overview).toBe('Sinopse & mais.');
    expect(body.posterUrl).toBe('https://static.example.test/rota.jpg');
    expect(body.attribution).toEqual({ name: 'TVmaze', url: 'https://www.tvmaze.com/', license: 'CC BY-SA' });
    expect(body.library).toBeNull();

    // Temporada 0 (especiais) sem número de episódio não entra; a 1 tem dois.
    expect(body.seasons.map((s: { seasonNumber: number }) => s.seasonNumber)).toEqual([1]);
    expect(body.seasons[0].episodes).toHaveLength(2);

    const db = await getDb();
    const row = db.query<{ source: string; source_id: string; media_type: string }, []>('SELECT source, source_id, media_type FROM titles').get();
    expect(row).toEqual({ source: 'tvmaze', source_id: '9101', media_type: 'tv' });
  });

  test('episódio futuro de um título da lista aparece no calendário, com a fonte tvmaze', async () => {
    globalThis.fetch = (async () => json(showWith(9102))) as unknown as typeof fetch;
    const detail = await (await tvmazeRoutes.request('/9102')).json();

    // Entra na lista pela rota de biblioteca real, como o botão da página faz.
    const add = await libraryRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'tvmaze', sourceId: '9102', mediaType: 'tv', title: 'Série Rota', watchStatus: 'watching' }),
    });
    expect(add.status).toBe(201);
    expect(detail.titleId).toBeTruthy();

    const cal = await (await calendarRoutes.request('/?days=30')).json();
    const upcoming = cal.entries.find((e: { episodeName: string }) => e.episodeName === 'Próximo');
    expect(upcoming).toMatchObject({ kind: 'episode', titleSource: 'tvmaze', titleSourceId: '9102', date: tomorrow(), seasonNumber: 1, episodeNumber: 2 });
    expect(cal.entries.find((e: { episodeName: string }) => e.episodeName === 'Piloto')).toBeUndefined();
  });

  test('id que não é número inteiro positivo é 400 e nem chama a API', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;
    for (const bad of ['abc', '1.5', '-3', '1e3', '99999999999']) {
      expect((await tvmazeRoutes.request(`/${bad}`)).status).toBe(400);
    }
    expect(called).toBe(false);
  });

  test('falha da TVmaze vira 502 com mensagem nossa, sem o corpo cru', async () => {
    globalThis.fetch = (async () => new Response('<html>stack trace interno</html>', { status: 500 })) as unknown as typeof fetch;
    const res = await tvmazeRoutes.request('/9103');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('stack trace');
    expect(JSON.parse(text).error).toContain('TVmaze');
  });

  test('série inexistente na TVmaze vira 404', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect((await tvmazeRoutes.request('/9104')).status).toBe(404);
  });
});

describe('GET /api/tvmaze/search', () => {
  test('exige q', async () => {
    expect((await tvmazeRoutes.request('/search')).status).toBe(400);
  });

  test('devolve resultados mapeados', async () => {
    globalThis.fetch = (async () => json([{ score: 1, show: { id: 9105, name: 'Busca Rota', premiered: '2019-05-05', image: null, rating: { average: null } } }])) as unknown as typeof fetch;
    const body = await (await tvmazeRoutes.request('/search?q=busca-rota-tvmaze-9105')).json();
    expect(body.results).toEqual([{ id: 9105, name: 'Busca Rota', year: '2019', status: null, overview: null, imageUrl: null, rating: null }]);
  });
});
