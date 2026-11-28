import { afterEach, describe, expect, test } from 'bun:test';
import { cinemetaSearch, parseCinemeta, setCinemetaFetchForTests } from '../../src/server/providers/cinemeta.ts';

afterEach(() => setCinemetaFetchForTests());

describe('Cinemeta (sugestões sem chave)', () => {
  test('lê nome e ano e descarta item sem nome ou fora do formato', () => {
    const body = { metas: [{ name: 'The Simpsons', releaseInfo: '1989–' }, { name: '  ' }, { releaseInfo: '2000' }, 'x', { name: 'Sem ano' }] };
    expect(parseCinemeta(body, 'tv')).toEqual([
      { title: 'The Simpsons', year: '1989', mediaType: 'tv' },
      { title: 'Sem ano', year: null, mediaType: 'tv' },
    ]);
    expect(parseCinemeta({ metas: 'nope' }, 'movie')).toEqual([]);
  });

  test('intercala séries e filmes; um tipo fora do ar não derruba o outro', async () => {
    const seen: string[] = [];
    setCinemetaFetchForTests(async (url) => {
      seen.push(url);
      if (url.includes('/movie/')) return new Response('erro', { status: 500 });
      return Response.json({ metas: [{ name: 'The Simpsons', releaseInfo: '1989' }, { name: 'The Simple Life', releaseInfo: '2003' }] });
    });
    const hits = await cinemetaSearch('the simp');
    expect(hits.map((h) => h.title)).toEqual(['The Simpsons', 'The Simple Life']);
    setCinemetaFetchForTests(async () => new Response('erro', { status: 503 }));
    await expect(cinemetaSearch('fora do ar')).rejects.toThrow();
    expect(seen.every((u) => u.startsWith('https://v3-cinemeta.strem.io/catalog/') && u.includes('search=the%20simp.json'))).toBe(true);
  });
});
