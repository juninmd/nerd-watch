import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CatalogRequestError } from '../src/server/catalog-text.ts';
import { anilistDetails, anilistSearch, resetAnilistRateLimitForTests } from '../src/server/providers/anilist.ts';

/** Mídia sintética no formato documentado do AniList (campos mínimos). */
const MEDIA = {
  id: 8001,
  siteUrl: 'https://anilist.co/anime/8001',
  title: { romaji: 'Teste Romaji', english: 'Test English', native: 'テスト' },
  format: 'TV',
  status: 'RELEASING',
  startDate: { year: 2020 },
  coverImage: { large: 'https://img.example.test/cover.png' },
  averageScore: 75,
  episodes: 12,
  description: 'Primeira frase.<br><br>~!Spoiler aqui!~ fim.',
  nextAiringEpisode: null,
};

const realFetch = globalThis.fetch;
type Captured = { url: string; method: string; body: { query: string; variables: Record<string, unknown> } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Captura cada chamada para inspecionar a consulta enviada (e provar que o termo só vai em `variables`). */
const fakeFetch = (respond: (captured: Captured) => Response): Captured[] => {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: JSON.parse(String(init?.body ?? '{}')) as Captured['body'],
    };
    calls.push(captured);
    return respond(captured);
  }) as unknown as typeof fetch;
  return calls;
};

let seq = 0;
const uniq = (label: string): string => `${label}-${++seq}`;

beforeEach(() => {
  resetAnilistRateLimitForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('anilistSearch', () => {
  test('o termo vai só em variables; a consulta é a mesma para termos hostis', async () => {
    const calls = fakeFetch(() => json({ data: { Page: { media: [] } } }));
    const hostile = `x" } } query { evil } { "${uniq('h')}`;
    await anilistSearch(hostile);
    await anilistSearch(uniq('normal'));

    expect(calls[0]?.url).toBe('https://graphql.anilist.co');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body.variables.search).toBe(hostile);
    expect(calls[0]?.body.query).not.toContain('evil');
    expect(calls[1]?.body.query).toBe(calls[0]?.body.query);
  });

  test('mapeia título (inglês antes do romaji), ano, nota em escala 0-100 e descrição em texto', async () => {
    fakeFetch(() => json({ data: { Page: { media: [MEDIA, { ...MEDIA, id: 8002, title: { romaji: 'So', english: null, native: null } }] } } }));
    const [first, second] = await anilistSearch(uniq('mapeia'));
    expect(first).toMatchObject({ id: 8001, title: 'Test English', romaji: 'Teste Romaji', year: '2020', averageScore: 75, episodes: 12 });
    // Trecho marcado como spoiler pelo AniList (~! !~) é descartado: a sinopse do detalhe não o revela.
    expect(first?.overview).toBe('Primeira frase.\n\nfim.');
    expect(first?.overview).not.toContain('Spoiler');
    expect(first?.imageUrl).toBe('https://img.example.test/cover.png');
    expect(second?.title).toBe('So');
  });

  test('erro GraphQL vira 502 com mensagem nossa, sem repassar o texto da API', async () => {
    fakeFetch(() => json({ errors: [{ message: 'detalhe interno do serviço', status: 500 }], data: null }));
    const err = await anilistSearch(uniq('erro')).catch((e) => e);
    expect(err).toBeInstanceOf(CatalogRequestError);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('detalhe interno');
  });

  test('429 do AniList vira mensagem amigável com status 429', async () => {
    fakeFetch(() => new Response('Too Many Requests', { status: 429 }));
    const err = await anilistSearch(uniq('429')).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toContain('AniList');
  });

  test('resposta sem data válida vira 502', async () => {
    fakeFetch(() => json({ data: { Page: 'nope' } }));
    expect((await anilistSearch(uniq('sem-page')).catch((e) => e)).status).toBe(502);
  });

  test('limite local de 30 por minuto: a 31ª nem chega à rede', async () => {
    const calls = fakeFetch(() => json({ data: { Page: { media: [] } } }));
    for (let i = 0; i < 30; i++) await anilistSearch(uniq('janela'));
    const err = await anilistSearch(uniq('janela-31')).catch((e) => e);
    expect(err.status).toBe(429);
    expect(calls).toHaveLength(30);
  });
});

describe('anilistDetails', () => {
  test('mapeia o próximo episódio (airingAt em segundos) e o link da página', async () => {
    const airingAt = 1_900_000_000;
    fakeFetch(() => json({ data: { Media: { ...MEDIA, nextAiringEpisode: { airingAt, episode: 5 } } } }));
    const details = await anilistDetails(8001);
    expect(details.nextAiringEpisode).toEqual({ airingAt, episode: 5 });
    expect(details.siteUrl).toBe('https://anilist.co/anime/8001');
    expect(details.status).toBe('RELEASING');
  });

  test('sem próximo episódio, nextAiringEpisode é null', async () => {
    fakeFetch(() => json({ data: { Media: MEDIA } }));
    expect((await anilistDetails(8002)).nextAiringEpisode).toBeNull();
  });

  test('Media null ou erro 404 da API vira 404 com mensagem nossa', async () => {
    fakeFetch(() => json({ data: { Media: null } }));
    expect((await anilistDetails(8003).catch((e) => e)).status).toBe(404);

    fakeFetch(() => json({ errors: [{ message: 'Not Found.', status: 404 }], data: null }));
    const err = await anilistDetails(8004).catch((e) => e);
    expect(err.status).toBe(404);
    expect(err.message).not.toContain('Not Found.');
  });

  test('pede Media por id como variável inteira, nunca interpolado', async () => {
    const calls = fakeFetch(() => json({ data: { Media: MEDIA } }));
    await anilistDetails(8005);
    expect(calls[0]?.body.variables).toEqual({ id: 8005 });
    expect(calls[0]?.body.query).not.toContain('8005');
  });

  test('falha de rede vira 502 com mensagem nossa', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed: detalhe de rede');
    }) as unknown as typeof fetch;
    const err = await anilistDetails(8006).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toBe('AniList indisponível no momento');
  });
});
