import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { todayIso } from '../src/server/date.ts';
import { resetAnilistRateLimitForTests } from '../src/server/providers/anilist.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { calendarRoutes } from '../src/server/routes/calendar.ts';
import { anilistRoutes } from '../src/server/routes/anilist.ts';
import { searchRoutes } from '../src/server/routes/search.ts';

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const media = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  siteUrl: `https://anilist.co/anime/${id}`,
  title: { romaji: 'Anime Rota', english: 'Route Anime', native: 'ルート' },
  format: 'TV',
  status: 'RELEASING',
  startDate: { year: 2024 },
  coverImage: { large: 'https://img.example.test/rota.png' },
  averageScore: 80,
  episodes: null,
  description: 'Sinopse<br>de teste.',
  nextAiringEpisode: null,
  ...over,
});

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  resetAnilistRateLimitForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /api/anilist/:id', () => {
  test('grava o título com mídia tv, nota em 0-10 e devolve a atribuição', async () => {
    globalThis.fetch = (async () => json({ data: { Media: media(9201) } })) as unknown as typeof fetch;
    const res = await anilistRoutes.request('/9201');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ title: 'Route Anime', romaji: 'Anime Rota', mediaType: 'tv', voteAverage: 8, overview: 'Sinopse\nde teste.' });
    expect(body.attribution).toEqual({ name: 'AniList', url: 'https://anilist.co/' });
    expect(body.nextEpisode).toBeNull();

    const db = await getDb();
    expect(db.query<{ source: string; media_type: string }, []>('SELECT source, media_type FROM titles').get()).toEqual({ source: 'anilist', media_type: 'tv' });
  });

  test('filme de anime vira mediaType movie', async () => {
    globalThis.fetch = (async () => json({ data: { Media: media(9202, { format: 'MOVIE' }) } })) as unknown as typeof fetch;
    const body = await (await anilistRoutes.request('/9202')).json();
    expect(body.mediaType).toBe('movie');
  });

  test('próximo episódio entra no calendário com a data local do horário de exibição', async () => {
    const airingAt = Math.floor(Date.now() / 1000) + 86_400;
    globalThis.fetch = (async () => json({ data: { Media: media(9203, { nextAiringEpisode: { airingAt, episode: 4 } }) } })) as unknown as typeof fetch;

    const detail = await (await anilistRoutes.request('/9203')).json();
    const expectedDate = todayIso(new Date(airingAt * 1000));
    expect(detail.nextEpisode).toEqual({ episode: 4, airDate: expectedDate });

    // Entra na lista para o calendário considerar o título.
    upsertLibraryEntry(await getDb(), detail.titleId, { watchStatus: 'watching' });

    const cal = await (await calendarRoutes.request('/?days=30')).json();
    expect(cal.entries).toEqual([
      expect.objectContaining({ kind: 'episode', titleSource: 'anilist', titleSourceId: '9203', date: expectedDate, episodeNumber: 4, episodeName: 'Episódio 4' }),
    ]);
  });

  test('id inválido é 400 e 404 do AniList vira 404', async () => {
    expect((await anilistRoutes.request('/xyz')).status).toBe(400);

    globalThis.fetch = (async () => json({ data: { Media: null } })) as unknown as typeof fetch;
    expect((await anilistRoutes.request('/9204')).status).toBe(404);
  });

  test('erro do AniList vira 502 com mensagem nossa', async () => {
    globalThis.fetch = (async () => new Response('{"errors":[{"message":"segredo interno"}]}', { status: 500 })) as unknown as typeof fetch;
    const res = await anilistRoutes.request('/9205');
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('segredo');
  });
});

describe('GET /api/anilist/search', () => {
  test('exige q e recusa termo longo demais antes de chamar a API', async () => {
    expect((await anilistRoutes.request('/search')).status).toBe(400);
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return json({});
    }) as unknown as typeof fetch;
    expect((await anilistRoutes.request(`/search?q=${'a'.repeat(201)}`)).status).toBe(400);
    expect(called).toBe(false);
  });
});

describe('GET /api/search com as fontes sem chave', () => {
  test('mostra TVmaze e AniList com a fonte marcada, e uma fonte fora do ar não derruba as outras', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('tvmaze.com')) return json([{ score: 1, show: { id: 9301, name: 'Série Busca', premiered: '2020-01-01', image: null, rating: { average: 5 } } }]);
      if (url.includes('anilist.co')) return new Response('down', { status: 503 });
      return json({ response: { docs: [] } });
    }) as unknown as typeof fetch;

    const body = await (await searchRoutes.request('/?q=busca-mista-9301')).json();
    expect(body.results).toEqual([
      expect.objectContaining({ source: 'tvmaze', sourceId: '9301', mediaType: 'tv', title: 'Série Busca', releaseDate: '2020-01-01' }),
    ]);
  });

  test('anime do AniList aparece com mediaType derivado do formato', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('anilist.co')) return json({ data: { Page: { media: [media(9302, { format: 'MOVIE', averageScore: null })] } } });
      return json([]);
    }) as unknown as typeof fetch;

    const body = await (await searchRoutes.request('/?q=busca-anime-9302')).json();
    expect(body.results).toEqual([expect.objectContaining({ source: 'anilist', sourceId: '9302', mediaType: 'movie', voteAverage: null })]);
  });
});
