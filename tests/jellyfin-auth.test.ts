import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { jellyfinSource, registerJellyfin } from '../src/server/providers/jellyfin/source.ts';
import { setMediaFetchForTests } from '../src/server/providers/sources/media-server.ts';
import { restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';

/** Autenticação e configuração do Jellyfin. Mesmo fixture de `jellyfin-source.test.ts`: token óbvio, sem rede. */
const TOKEN = 'fake-token';
const BASE = 'http://192.168.0.10:8096';
const LIB = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const snapshot = snapshotRegistry();
const calls: Array<{ url: URL; init: RequestInit }> = [];
let handler: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json({});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const headerOf = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);
const allUrls = (): string[] => calls.map((c) => c.url.toString());

beforeAll(() => registerJellyfin());
afterAll(() => restoreRegistry(snapshot));

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  calls.length = 0;
  handler = () => json({});
  process.env.JELLYFIN_URL = BASE;
  process.env.JELLYFIN_API_KEY = TOKEN;
  setMediaFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  });
});

afterEach(() => {
  setMediaFetchForTests();
  delete process.env.JELLYFIN_URL;
  delete process.env.JELLYFIN_API_KEY;
});

const post = (path: string, body: unknown) => sourcesRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('autenticação', () => {
  test('manda a chave no cabeçalho oficial, nunca na URL', async () => {
    handler = () => json([{ Name: 'Séries', ItemId: LIB }]);
    await jellyfinSource.resolve('Séries');
    expect(headerOf(calls[0]?.init ?? {}, 'Authorization')).toBe(`MediaBrowser Token="${TOKEN}"`);
    for (const url of allUrls()) {
      expect(url).not.toContain(TOKEN);
      expect(url).not.toContain('api_key');
    }
  });

  test('401 do servidor vira 409 com mensagem nossa, sem a chave', async () => {
    handler = () => new Response('{"message":"token inválido fake-token"}', { status: 401 });
    const err = await jellyfinSource.resolve('Séries').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(409);
    expect((err as SourceError).message).toContain('confira em Conexões');
    expect((err as SourceError).message).not.toContain(TOKEN);
  });

  test('401 pela rota de canais também responde 409 e não ecoa o corpo do servidor', async () => {
    handler = () => new Response('segredo interno do servidor', { status: 401 });
    const res = await post('/jellyfin/channels', { input: 'Séries' });
    const text = await res.text();
    expect(res.status).toBe(409);
    expect(text).not.toContain('segredo interno');
    expect(text).not.toContain(TOKEN);
  });

  test('sem URL ou chave configurada não chama o servidor e pede configuração (501)', async () => {
    delete process.env.JELLYFIN_API_KEY;
    const err = await jellyfinSource.resolve('Séries').catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(501);
    expect(calls).toHaveLength(0);
  });

  test('a chave não aparece na listagem de fontes que vai para o navegador', async () => {
    const text = await (await sourcesRoutes.request('/')).text();
    expect(text).not.toContain(TOKEN);
    expect(text).toContain('"set":true');
  });
});

describe('configuração pela rota de Conexões', () => {
  test.each([
    [{ url: 'ftp://192.168.0.10' }, 'protocolo'],
    [{ url: 'http://fake-user:fake-pass@192.168.0.10:8096' }, 'usuário e senha'],
    [{ apiKey: 'abc"; evil' }, 'chave com aspas'],
    [{ apiKey: 'curta' }, 'chave curta demais'],
  ])('rejeita %j (%s)', async (values) => {
    const res = await post('/jellyfin/settings', { values });
    expect(res.status).toBe(400);
  });

  test('aceita a configuração válida e nunca devolve a chave', async () => {
    delete process.env.JELLYFIN_URL;
    delete process.env.JELLYFIN_API_KEY;
    const res = await post('/jellyfin/settings', { values: { url: BASE, apiKey: 'fake-api-key-123' } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('fake-api-key-123');
    expect(text).toContain('"configured":true');
  });
});
