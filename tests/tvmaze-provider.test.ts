import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CatalogRequestError } from '../src/server/catalog-text.ts';
import { resetTvmazeRateLimitForTests, tvmazeSearchShows, tvmazeShowDetails } from '../src/server/providers/tvmaze.ts';

/** Respostas sintéticas no formato documentado da TVmaze (poucos campos, sem conteúdo real). */
const SHOW = {
  id: 7001,
  url: 'https://www.tvmaze.com/shows/7001/serie-fake',
  name: 'Série Fake',
  status: 'Ended',
  premiered: '2013-06-24',
  ended: '2015-09-10',
  summary: '<p>Uma cidade <b>fechada</b>.<br>Fim.</p>',
  image: { medium: 'https://static.example.test/m.jpg', original: 'https://static.example.test/o.jpg' },
  rating: { average: 6.6 },
  officialSite: 'https://www.example.test/serie',
};

const EPISODE = (over: Record<string, unknown>) => ({
  id: 1,
  name: 'Piloto',
  season: 1,
  number: 1,
  airdate: '2013-06-24',
  runtime: 60,
  summary: '<p>Início.</p>',
  image: null,
  ...over,
});

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let seq = 0;
/** Termo único por teste: o cache de módulo não pode responder a um teste com a resposta de outro. */
const uniq = (label: string): string => `${label}-${++seq}`;

beforeEach(() => {
  resetTvmazeRateLimitForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('tvmazeSearchShows', () => {
  test('manda o termo em ?q= com encoding (aspas, chaves e & não viram parâmetro extra)', async () => {
    const seen: URL[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(new URL(String(input)));
      return json([{ score: 1, show: SHOW }]);
    }) as unknown as typeof fetch;

    const term = uniq('a&b="c"{x}');
    await tvmazeSearchShows(term);
    expect(seen[0]?.pathname).toBe('/search/shows');
    expect(seen[0]?.searchParams.get('q')).toBe(term);
    expect(seen[0]?.searchParams.has('x')).toBe(false);
  });

  test('mapeia série, ano, sinopse em texto puro e imagem https', async () => {
    globalThis.fetch = (async () => json([{ score: 1, show: SHOW }])) as unknown as typeof fetch;
    const [first] = await tvmazeSearchShows(uniq('mapeia'));
    expect(first).toEqual({
      id: 7001,
      name: 'Série Fake',
      year: '2013',
      status: 'Ended',
      overview: 'Uma cidade fechada.\nFim.',
      imageUrl: 'https://static.example.test/m.jpg',
      rating: 6.6,
    });
  });

  test('ignora entradas sem show e pula o resto em vez de falhar', async () => {
    globalThis.fetch = (async () => json([{ score: 1 }, { score: 0.5, show: SHOW }])) as unknown as typeof fetch;
    const results = await tvmazeSearchShows(uniq('sem-show'));
    expect(results.map((r) => r.id)).toEqual([7001]);
  });

  test('resposta que não é lista vira mensagem nossa (502), nunca o corpo cru', async () => {
    globalThis.fetch = (async () => json({ response: { docs: [{ secret: 'corpo-cru' }] } })) as unknown as typeof fetch;
    const err = await tvmazeSearchShows(uniq('nao-lista')).catch((e) => e);
    expect(err).toBeInstanceOf(CatalogRequestError);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('corpo-cru');
  });

  test('429 da TVmaze vira mensagem amigável com status 429', async () => {
    globalThis.fetch = (async () => new Response('Too many', { status: 429 })) as unknown as typeof fetch;
    const err = await tvmazeSearchShows(uniq('429')).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toContain('TVmaze');
    expect(err.message).not.toContain('Too many');
  });

  test('500 com HTML: a mensagem não inclui o corpo', async () => {
    globalThis.fetch = (async () => new Response('<html>erro interno vazado</html>', { status: 500 })) as unknown as typeof fetch;
    const err = await tvmazeSearchShows(uniq('500')).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('vazado');
  });

  test('falha de rede ou timeout vira 502 com mensagem nossa', async () => {
    globalThis.fetch = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    const err = await tvmazeSearchShows(uniq('timeout')).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toBe('TVmaze indisponível no momento');
  });

  test('limite local de 20 chamadas por 10 s: a 21ª nem chega à rede', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return json([]);
    }) as unknown as typeof fetch;
    for (let i = 0; i < 20; i++) await tvmazeSearchShows(uniq('janela'));
    const err = await tvmazeSearchShows(uniq('janela-21')).catch((e) => e);
    expect(err.status).toBe(429);
    expect(calls).toBe(20);
  });
});

describe('tvmazeShowDetails', () => {
  test('pede embed=episodes e agrupa dados de episódio com data de exibição', async () => {
    const seen: URL[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(new URL(String(input)));
      return json({ ...SHOW, _embedded: { episodes: [EPISODE({ airdate: '2013-06-24' }), EPISODE({ id: 2, number: 2, airdate: null })] } });
    }) as unknown as typeof fetch;

    const details = await tvmazeShowDetails(7001);
    expect(seen[0]?.pathname).toBe('/shows/7001');
    expect(seen[0]?.searchParams.get('embed')).toBe('episodes');
    expect(details.pageUrl).toBe('https://www.tvmaze.com/shows/7001/serie-fake');
    expect(details.episodes).toHaveLength(2);
    expect(details.episodes[0]?.airdate).toBe('2013-06-24');
    expect(details.episodes[1]?.airdate).toBeNull();
  });

  test('data de exibição fora do formato AAAA-MM-DD é descartada (não polui o calendário)', async () => {
    globalThis.fetch = (async () =>
      json({ ...SHOW, _embedded: { episodes: [EPISODE({ airdate: '24/06/2013' }), EPISODE({ id: 3, number: 3, airdate: '2013-06-24T20:00' })] } })) as unknown as typeof fetch;
    const details = await tvmazeShowDetails(7002);
    expect(details.episodes.map((e) => e.airdate)).toEqual([null, null]);
  });

  test('episódio sem temporada numérica é ignorado; sem número fica com number null', async () => {
    globalThis.fetch = (async () =>
      json({ ...SHOW, _embedded: { episodes: [EPISODE({ season: 'x' }), EPISODE({ id: 4, number: null, name: '' })] } })) as unknown as typeof fetch;
    const details = await tvmazeShowDetails(7003);
    expect(details.episodes).toHaveLength(1);
    expect(details.episodes[0]?.number).toBeNull();
    expect(details.episodes[0]?.name).toBe('Sem título');
  });

  test('imagem e site oficial só com https: javascript: vira null', async () => {
    globalThis.fetch = (async () =>
      json({ ...SHOW, image: { medium: 'javascript:alert(1)' }, officialSite: 'http://insecure.example.test', _embedded: { episodes: [] } })) as unknown as typeof fetch;
    const details = await tvmazeShowDetails(7004);
    expect(details.imageUrl).toBeNull();
    expect(details.officialUrl).toBeNull();
  });

  test('404 da TVmaze vira 404 com mensagem nossa', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const err = await tvmazeShowDetails(7005).catch((e) => e);
    expect(err.status).toBe(404);
    expect(err.message).toContain('não encontrado');
  });

  test('JSON inválido ou formato inesperado vira 502', async () => {
    globalThis.fetch = (async () => new Response('{not json', { status: 200 })) as unknown as typeof fetch;
    expect((await tvmazeShowDetails(7006).catch((e) => e)).status).toBe(502);

    globalThis.fetch = (async () => json([SHOW])) as unknown as typeof fetch;
    expect((await tvmazeShowDetails(7007).catch((e) => e)).status).toBe(502);
  });
});
