import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { plexSource, registerPlex } from '../src/server/providers/plex/source.ts';
import { setMediaFetchForTests } from '../src/server/providers/sources/media-server.ts';
import { restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';
import { sourcesRoutes } from '../src/server/routes/sources.ts';

/** Autenticação e configuração do Plex. Mesmo fixture de `plex-source.test.ts`: token óbvio, sem rede. */
const TOKEN = 'fake-token';
const BASE = 'http://192.168.0.10:32400';

const snapshot = snapshotRegistry();
const calls: Array<{ url: URL; init: RequestInit }> = [];
let handler: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json({ MediaContainer: {} });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const headerOf = (init: RequestInit, name: string): string | null => new Headers(init.headers).get(name);
const allUrls = (): string[] => calls.map((c) => c.url.toString());

/** Função, não Response: um corpo de Response só pode ser lido uma vez, e cada chamada precisa do seu. */
const sections = () =>
  json({
    MediaContainer: {
      Directory: [
        { key: '1', title: 'Filmes', type: 'movie' },
        { key: '2', title: 'Séries', type: 'show' },
      ],
    },
  });

beforeAll(() => registerPlex());
afterAll(() => restoreRegistry(snapshot));

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  calls.length = 0;
  handler = () => json({ MediaContainer: {} });
  process.env.PLEX_URL = BASE;
  process.env.PLEX_TOKEN = TOKEN;
  setMediaFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  });
});

afterEach(() => {
  setMediaFetchForTests();
  delete process.env.PLEX_URL;
  delete process.env.PLEX_TOKEN;
});

const post = (path: string, body: unknown) => sourcesRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('autenticação e identificação', () => {
  test('token no cabeçalho X-Plex-Token, JSON pedido por Accept, identificação do cliente; nunca na URL', async () => {
    handler = () => sections();
    await plexSource.resolve('Filmes');
    const init = calls[0]?.init ?? {};
    expect(headerOf(init, 'X-Plex-Token')).toBe(TOKEN);
    expect(headerOf(init, 'Accept')).toBe('application/json');
    expect(headerOf(init, 'X-Plex-Client-Identifier')).toBe('nerd-watch');
    expect(headerOf(init, 'X-Plex-Product')).toBe('nerd-watch');
    for (const url of allUrls()) {
      expect(url).not.toContain(TOKEN);
      expect(url).not.toContain('X-Plex-Token');
      expect(url).not.toContain('token=');
    }
  });

  test('401 vira 409 com mensagem nossa, sem o token nem o corpo do servidor', async () => {
    handler = () => new Response(`token ${TOKEN} recusado pelo servidor`, { status: 401 });
    const err = await plexSource.resolve('Filmes').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(409);
    expect((err as SourceError).message).toBe('token recusado pelo Plex — confira em Conexões');
  });

  test('401 pela rota de canais responde 409 e não ecoa o token', async () => {
    handler = () => new Response(`corpo com ${TOKEN}`, { status: 401 });
    const res = await post('/plex/channels', { input: 'Filmes' });
    const text = await res.text();
    expect(res.status).toBe(409);
    expect(text).not.toContain(TOKEN);
  });

  test('sem endereço ou token configurado não chama o servidor (501)', async () => {
    delete process.env.PLEX_TOKEN;
    const err = await plexSource.resolve('Filmes').catch((e: unknown) => e);
    expect((err as SourceError).status).toBe(501);
    expect(calls).toHaveLength(0);
  });

  test('o token não aparece na listagem de fontes que vai para o navegador', async () => {
    const text = await (await sourcesRoutes.request('/')).text();
    expect(text).not.toContain(TOKEN);
    expect(text).toContain('"set":true');
  });
});

describe('configuração pela rota de Conexões', () => {
  test.each([
    [{ url: 'ftp://192.168.0.10:32400' }, 'protocolo'],
    [{ url: 'http://fake-user:fake-pass@192.168.0.10:32400' }, 'usuário e senha'],
    [{ token: 'abc def' }, 'token com espaço'],
    [{ token: 'abc"; evil' }, 'token com aspas'],
  ])('rejeita %j (%s)', async (values) => {
    expect((await post('/plex/settings', { values })).status).toBe(400);
  });

  test('aceita a configuração válida e nunca devolve o token', async () => {
    delete process.env.PLEX_URL;
    delete process.env.PLEX_TOKEN;
    const res = await post('/plex/settings', { values: { url: BASE, token: 'fake-plex-token-1' } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('fake-plex-token-1');
    expect(text).toContain('"configured":true');
  });
});
