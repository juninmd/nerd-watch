import { describe, expect, test } from 'bun:test';
import { withLoginRedirect } from '../src/client/auth-redirect.ts';

const BASE = 'http://nerd.test/';

const setup = (status: number) => {
  const seen: string[] = [];
  const navigations: string[] = [];
  const fetchFn = withLoginRedirect(
    async (input) => {
      seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return new Response(null, { status });
    },
    BASE,
    (href) => navigations.push(href),
  );
  return { fetchFn, navigations, seen };
};

describe('withLoginRedirect', () => {
  test('401 de chamada /api leva para a página de login', async () => {
    const { fetchFn, navigations } = setup(401);
    const res = await fetchFn('/api/library');
    expect(res.status).toBe(401);
    expect(navigations).toEqual(['/login']);
  });

  test('401 com URL absoluta ou objeto URL também conta', async () => {
    const { fetchFn, navigations } = setup(401);
    await fetchFn(new URL('/api/sources', BASE));
    await fetchFn('http://nerd.test/api/drive');
    expect(navigations).toEqual(['/login', '/login']);
  });

  test('outras respostas e 401 fora de /api não navegam', async () => {
    const ok = setup(200);
    await ok.fetchFn('/api/library');
    expect(ok.navigations).toEqual([]);

    const notFound = setup(404);
    await notFound.fetchFn('/api/library');
    expect(notFound.navigations).toEqual([]);

    const outside = setup(401);
    await outside.fetchFn('/static/x.js');
    expect(outside.navigations).toEqual([]);
  });

  test('repassa a requisição sem alterar método, corpo ou cabeçalhos', async () => {
    const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
    const fetchFn = withLoginRedirect(
      async (input, init) => {
        calls.push({ input, init });
        return new Response('{}', { status: 200 });
      },
      BASE,
      () => {},
    );
    const init = { method: 'POST', body: '{"a":1}' };
    await fetchFn('/api/library', init);
    expect(calls[0]?.init).toBe(init);
    expect(calls[0]?.input).toBe('/api/library');
  });
});
