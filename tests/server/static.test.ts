import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { acceptedEncodings, createStaticHandler, resolveStaticPath } from '../../src/server/http/static.ts';

const tmp = mkdtempSync(path.join(tmpdir(), 'nw-static-'));
const root = path.join(tmp, 'public');
mkdirSync(path.join(root, 'assets'), { recursive: true });
writeFileSync(path.join(tmp, 'segredo.txt'), 'fora da raiz');

const JS = 'export const x = 1;'.repeat(200);
const put = (rel: string, content: string, compressed = true): void => {
  const file = path.join(root, rel);
  writeFileSync(file, content);
  if (!compressed) return;
  writeFileSync(`${file}.br`, brotliCompressSync(Buffer.from(content)));
  writeFileSync(`${file}.gz`, gzipSync(Buffer.from(content)));
};
put('index.html', '<!doctype html><div id="app"></div>');
put('assets/main-abc123.js', JS);
put('sw.js', 'self.x = 1;', false);

const app = new Hono();
app.use('/*', createStaticHandler(root));
app.post('/eco', (c) => c.text('post chegou'));

const get = (url: string, headers: Record<string, string> = {}, method = 'GET') => app.request(url, { method, headers });
const bytes = async (res: Response): Promise<Uint8Array> => new Uint8Array(await res.arrayBuffer());

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('estático: cache', () => {
  test('/assets/* com hash vai com cache imutável de um ano', async () => {
    const res = await get('/assets/main-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
  });

  test('index.html e sw.js sempre revalidam (no-cache + ETag)', async () => {
    for (const url of ['/', '/index.html', '/sw.js']) {
      const res = await get(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('ETag')).toMatch(/^W\/"/);
    }
  });

  test('If-None-Match com a ETag atual devolve 304 sem corpo', async () => {
    const etag = (await get('/')).headers.get('ETag') as string;
    const res = await get('/', { 'If-None-Match': etag });
    expect(res.status).toBe(304);
    expect((await bytes(res)).byteLength).toBe(0);
    expect((await get('/', { 'If-None-Match': '"outra"' })).status).toBe(200);
  });

  test('arquivo alterado muda a ETag', async () => {
    const before = (await get('/sw.js')).headers.get('ETag');
    writeFileSync(path.join(root, 'sw.js'), 'self.x = 22;');
    expect((await get('/sw.js')).headers.get('ETag')).not.toBe(before);
  });
});

describe('estático: pré-comprimido', () => {
  test('brotli quando o navegador aceita, e o conteúdo é o mesmo do original', async () => {
    const res = await get('/assets/main-abc123.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(res.headers.get('Content-Encoding')).toBe('br');
    expect(res.headers.get('Vary')).toBe('Accept-Encoding');
    const body = await bytes(res);
    expect(Number(res.headers.get('Content-Length'))).toBe(body.byteLength);
    expect(body.byteLength).toBeLessThan(JS.length / 5);
    expect(brotliDecompressSync(body).toString()).toBe(JS);
  });

  test('gzip quando só gzip é aceito; original quando nada é aceito ou br vem com q=0', async () => {
    const gz = await get('/assets/main-abc123.js', { 'Accept-Encoding': 'gzip' });
    expect(gz.headers.get('Content-Encoding')).toBe('gzip');
    expect(gunzipSync(await bytes(gz)).toString()).toBe(JS);

    const plain = await get('/assets/main-abc123.js');
    expect(plain.headers.get('Content-Encoding')).toBeNull();
    expect(await plain.text()).toBe(JS);

    const refused = await get('/assets/main-abc123.js', { 'Accept-Encoding': 'br;q=0, gzip;q=0' });
    expect(refused.headers.get('Content-Encoding')).toBeNull();
  });

  test('sem variante no disco, entrega o original', async () => {
    const res = await get('/sw.js', { 'Accept-Encoding': 'br, gzip' });
    expect(res.headers.get('Content-Encoding')).toBeNull();
    expect(await res.text()).toBe('self.x = 22;');
  });

  test('variante mais velha que o original (sobra de build) é ignorada', async () => {
    put('assets/velho-1.js', 'novo');
    const old = new Date(Date.now() - 60_000);
    utimesSync(path.join(root, 'assets/velho-1.js.br'), old, old);
    utimesSync(path.join(root, 'assets/velho-1.js.gz'), old, old);
    const res = await get('/assets/velho-1.js', { 'Accept-Encoding': 'br, gzip' });
    expect(res.headers.get('Content-Encoding')).toBeNull();
    expect(await res.text()).toBe('novo');
  });
});

describe('estático: limites', () => {
  test('HEAD devolve os cabeçalhos sem corpo', async () => {
    const res = await get('/assets/main-abc123.js', {}, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(JS.length));
    expect((await bytes(res)).byteLength).toBe(0);
  });

  test('outros métodos e arquivos inexistentes seguem para a próxima rota', async () => {
    expect(await (await app.request('/eco', { method: 'POST' })).text()).toBe('post chegou');
    expect((await get('/nao-existe.js')).status).toBe(404);
    expect((await get('/assets')).status).toBe(404);
  });

  test('traversal não lê arquivo fora da raiz', async () => {
    for (const url of ['/../segredo.txt', '/%2e%2e/segredo.txt', '/assets/..%2f..%2fsegredo.txt', '/..%5csegredo.txt', '/%00']) {
      const res = await get(url);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('fora da raiz');
    }
    expect(resolveStaticPath(root, '/../segredo.txt')).toBeNull();
    expect(resolveStaticPath(`${root}`, '/%E0%A4%A')).toBeNull();
    expect(resolveStaticPath(root, '/assets/main-abc123.js')).toBe(path.join(root, 'assets/main-abc123.js'));
  });
});

describe('acceptedEncodings', () => {
  test('lê a lista, ignora q=0 e tolera cabeçalho ausente', () => {
    expect([...acceptedEncodings('gzip, deflate, br;q=0.9')]).toEqual(['gzip', 'deflate', 'br']);
    expect(acceptedEncodings('br;q=0, gzip').has('br')).toBe(false);
    expect(acceptedEncodings(undefined).size).toBe(0);
  });
});
