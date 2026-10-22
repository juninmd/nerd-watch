import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { hrefToPath, setWebdavFetchForTests } from '../src/server/providers/webdav/api.ts';
import { validateWebdavUrl, webdavConfig } from '../src/server/providers/webdav/config.ts';
import { webdavSource } from '../src/server/providers/webdav/source.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';

const ORIGIN = 'https://nas.test';
const BASE_PATH = '/remote.php/dav/files/ana';
const PASSWORD = 'senha-de-teste-123';
const AUTH = `Basic ${btoa(`ana:${PASSWORD}`)}`;

/** Árvore falsa do servidor, relativa à raiz do WebDAV (`/Videos/Anime`...). */
const TREE: Record<string, Array<{ name: string; collection?: boolean; modified?: string }>> = {
  '/Videos': [{ name: 'Anime', collection: true }],
  '/Videos/Anime': [
    { name: 'Ep 01.mp4', modified: 'Wed, 01 Oct 2026 10:00:00 GMT' },
    { name: 'Ep 02 ç.mkv', modified: 'Thu, 02 Oct 2026 10:00:00 GMT' },
    { name: 'notas.txt', modified: 'Thu, 02 Oct 2026 11:00:00 GMT' },
    { name: 'Temporada 2', collection: true },
  ],
  '/Videos/Anime/Temporada 2': [
    { name: 'T2 01.webm', modified: 'Sat, 03 Oct 2026 10:00:00 GMT' },
    { name: 'Extras', collection: true },
  ],
  '/Videos/Anime/Temporada 2/Extras': [
    { name: 'bonus.mp4', modified: 'Sun, 04 Oct 2026 10:00:00 GMT' },
    { name: 'deep', collection: true },
  ],
  '/Videos/Anime/Temporada 2/Extras/deep': [{ name: 'fundo-demais.mp4', modified: 'Mon, 05 Oct 2026 10:00:00 GMT' }],
};

/** Respostas extras que o servidor "malicioso" injeta no PROPFIND da pasta do canal. */
let hostileExtras = '';
let fakeMode: 'normal' | 'redirect' | 'forbidden' | 'malformed' | 'huge' | 'network' = 'normal';
let calls: Array<{ url: string; method: string; auth: string | null; range: string | null; depth: string | null }> = [];

const hrefOf = (path: string, collection: boolean): string => {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${BASE_PATH}${encoded}${collection ? '/' : ''}`;
};

const entry = (href: string, collection: boolean, modified?: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? '<d:collection/>' : ''}</d:resourcetype>` +
  `${modified ? `<d:getlastmodified>${modified}</d:getlastmodified>` : ''}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

const multistatus = (path: string, depth: string | null): string => {
  const self = TREE[path];
  const fileSelf = fileAt(path);
  let body = '';
  if (self) body += entry(hrefOf(path, true), true);
  else if (fileSelf) body += entry(hrefOf(path, false), false, fileSelf.modified);
  if (self && depth !== '0') {
    for (const child of self) {
      const childPath = `${path}/${child.name}`;
      body += entry(hrefOf(childPath, Boolean(child.collection)), Boolean(child.collection), child.modified);
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${body}${depth === '0' ? '' : hostileExtras}</d:multistatus>`;
};

const fileAt = (path: string): { modified?: string } | null => {
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const child = TREE[parent]?.find((c) => c.name === name && !c.collection);
  return child ? { modified: child.modified } : null;
};

const fake = async (input: string | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  calls.push({ url: url.href, method: String(init?.method), auth: headers.get('authorization'), range: headers.get('range'), depth: headers.get('depth') });
  if (fakeMode === 'network') throw new Error('falha de rede simulada');
  if (fakeMode === 'redirect') return new Response('', { status: 302, headers: { Location: 'https://evil.test/roubo' } });
  if (fakeMode === 'forbidden') return new Response(`corpo do servidor com ${PASSWORD}`, { status: 401 });
  if (fakeMode === 'malformed') return new Response('<d:multistatus><d:response>', { status: 207 });
  if (fakeMode === 'huge') return new Response('<x/>', { status: 207, headers: { 'Content-Length': String(6 * 1024 * 1024) } });

  const path = decodeURIComponent(url.pathname).slice(BASE_PATH.length) || '/';
  if (init?.method === 'PROPFIND') {
    if (!TREE[path] && !fileAt(path)) return new Response('', { status: 404 });
    return new Response(multistatus(path, headers.get('depth')), { status: 207 });
  }
  if (!fileAt(path)) return new Response('', { status: 404 });
  const range = headers.get('range');
  if (range === 'bytes=0-9') {
    return new Response('ABCDEFGHIJ', { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-9/100', 'Content-Length': '10' } });
  }
  return new Response('VIDEO', { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '5', 'X-Upstream-Secret': 'nao-repassa' } });
};

beforeEach(() => {
  process.env.WEBDAV_URL = `${ORIGIN}${BASE_PATH}`;
  process.env.WEBDAV_USER = 'ana';
  process.env.WEBDAV_PASSWORD = PASSWORD;
  calls = [];
  hostileExtras = '';
  fakeMode = 'normal';
  setWebdavFetchForTests(fake);
});

afterEach(() => {
  setWebdavFetchForTests(null);
  delete process.env.WEBDAV_URL;
  delete process.env.WEBDAV_USER;
  delete process.env.WEBDAV_PASSWORD;
});

describe('configuração', () => {
  test('URL com usuário e senha embutidos, ou que não é http(s), é recusada', () => {
    expect(validateWebdavUrl('https://ana:segredo@nas.test/dav')).not.toBeNull();
    expect(validateWebdavUrl('ftp://nas.test/dav')).not.toBeNull();
    expect(validateWebdavUrl('https://nas.test/dav?x=1')).not.toBeNull();
    expect(validateWebdavUrl('http://192.168.0.10:8080/dav')).toBeNull();
  });

  test('sem variável obrigatória a fonte diz o que falta, sem tocar na rede', async () => {
    delete process.env.WEBDAV_PASSWORD;
    const err = await webdavSource.list('webdav:/Videos/Anime').catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(501);
    expect(calls).toHaveLength(0);
  });
});

describe('resolve (adicionar pasta)', () => {
  test('caminho na raiz vira handle estável, com nome da pasta; barra final é normalizada', async () => {
    expect(await webdavSource.resolve('/Videos/Anime')).toEqual({ handle: 'webdav:/Videos/Anime', name: 'Anime' });
    expect((await webdavSource.resolve('/Videos/Anime/')).handle).toBe('webdav:/Videos/Anime');
    expect(calls.every((c) => c.depth === '0' && c.method === 'PROPFIND')).toBe(true);
  });

  test('a credencial vai no Authorization para o servidor configurado, e só lá', async () => {
    await webdavSource.resolve('/Videos/Anime');
    expect(calls[0]?.auth).toBe(AUTH);
    expect(calls[0]?.url.startsWith(`${ORIGIN}${BASE_PATH}/`)).toBe(true);
  });

  test('caminho relativo, com .. ou com controle é recusado antes de qualquer requisição', async () => {
    for (const bad of ['Videos/Anime', '/Videos/../etc', '/Videos/An\u0001ime', '/a\\b']) {
      const err = await webdavSource.resolve(bad).catch((e) => e);
      expect((err as SourceError).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  test('um arquivo no lugar de pasta é 400; pasta inexistente é 404', async () => {
    expect(((await webdavSource.resolve('/Videos/Anime/Ep 01.mp4').catch((e) => e)) as SourceError).status).toBe(400);
    expect(((await webdavSource.resolve('/nao/existe').catch((e) => e)) as SourceError).status).toBe(404);
  });
});

describe('list (vídeos do canal)', () => {
  test('lista vídeos de até dois níveis de subpasta, do mais novo ao mais antigo, com caminho absoluto como fileRef', async () => {
    const items = await webdavSource.list('webdav:/Videos/Anime');
    expect(items.map((i) => i.caption)).toEqual(['bonus', 'T2 01', 'Ep 02 ç', 'Ep 01']);
    expect(items.map((i) => i.fileRef)).toEqual([
      '/Videos/Anime/Temporada 2/Extras/bonus.mp4',
      '/Videos/Anime/Temporada 2/T2 01.webm',
      '/Videos/Anime/Ep 02 ç.mkv',
      '/Videos/Anime/Ep 01.mp4',
    ]);
  });

  test('o nível 3 não é visitado (fundo-demais.mp4 fica de fora) e .txt é ignorado', async () => {
    const names = (await webdavSource.list('webdav:/Videos/Anime')).map((i) => i.fileRef);
    expect(names.some((n) => n?.includes('fundo-demais'))).toBe(false);
    expect(names.some((n) => n?.endsWith('notas.txt'))).toBe(false);
    expect(calls.map((c) => c.url)).not.toContain(`${ORIGIN}${BASE_PATH}/Videos/Anime/Temporada%202/Extras/deep/`);
  });

  test('mensagem de id é estável entre sincronizações', async () => {
    const a = await webdavSource.list('webdav:/Videos/Anime');
    const b = await webdavSource.list('webdav:/Videos/Anime');
    expect(a.map((i) => i.messageId)).toEqual(b.map((i) => i.messageId));
  });

  test('hrefs que escapam da pasta, de outra origem ou com .. são ignorados, sem virar item', async () => {
    hostileExtras =
      entry(`${BASE_PATH}/Videos/Outro/roubado.mp4`, false, 'Tue, 06 Oct 2026 10:00:00 GMT') +
      entry(`https://evil.test${BASE_PATH}/Videos/Anime/y.mp4`, false, 'Tue, 06 Oct 2026 10:00:00 GMT') +
      entry(`${BASE_PATH}/Videos/Anime/../../segredo.mp4`, false, 'Tue, 06 Oct 2026 10:00:00 GMT');
    const items = await webdavSource.list('webdav:/Videos/Anime');
    expect(items.some((i) => i.fileRef?.includes('roubado') || i.fileRef?.includes('segredo') || i.fileRef?.includes('y.mp4'))).toBe(false);
    expect(items).toHaveLength(4);
  });

  test('recusa resposta malformada, resposta gigante e falha de rede com mensagem nossa', async () => {
    fakeMode = 'malformed';
    expect(((await webdavSource.list('webdav:/Videos/Anime').catch((e) => e)) as SourceError).message).toBe('resposta do WebDAV inválida');
    fakeMode = 'huge';
    expect(((await webdavSource.list('webdav:/Videos/Anime').catch((e) => e)) as SourceError).status).toBe(502);
    fakeMode = 'network';
    const err = (await webdavSource.list('webdav:/Videos/Anime').catch((e) => e)) as SourceError;
    expect(err.message).toBe('não foi possível falar com o WebDAV agora');
    expect(err.message).not.toContain('falha de rede simulada');
  });
});

describe('play (proxy com Range)', () => {
  test('repassa o Range, devolve 206 com Content-Range e não vaza o Authorization nem cabeçalhos do servidor', async () => {
    const res = await webdavSource.play({ handle: 'webdav:/Videos/Anime', fileRef: '/Videos/Anime/Ep 01.mp4', range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-9/100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Authorization')).toBeNull();
    expect(res.headers.get('X-Upstream-Secret')).toBeNull();
    expect(await res.text()).toBe('ABCDEFGHIJ');
    expect(calls.at(-1)?.range).toBe('bytes=0-9');
    expect(calls.at(-1)?.auth).toBe(AUTH);
  });

  test('um fileRef fora da pasta do canal é 404 e não gera requisição', async () => {
    const err = (await webdavSource.play({ handle: 'webdav:/Videos/Anime', fileRef: '/Videos/Outro/x.mp4', range: undefined }).catch((e) => e)) as SourceError;
    expect(err.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('um fileRef com .. é 404 antes da rede', async () => {
    const err = (await webdavSource.play({ handle: 'webdav:/Videos/Anime', fileRef: '/Videos/Anime/../../etc/x.mp4', range: undefined }).catch((e) => e)) as SourceError;
    expect(err.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('redirect nunca é seguido: a credencial não sai para outra origem e o erro é nosso (502)', async () => {
    fakeMode = 'redirect';
    const err = (await webdavSource.play({ handle: 'webdav:/Videos/Anime', fileRef: '/Videos/Anime/Ep 01.mp4', range: undefined }).catch((e) => e)) as SourceError;
    expect(err.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('evil.test'))).toBe(false);
  });

  test('senha recusada vira 409 com mensagem nossa, sem ecoar o corpo do servidor', async () => {
    fakeMode = 'forbidden';
    const err = (await webdavSource.list('webdav:/Videos/Anime').catch((e) => e)) as SourceError;
    expect(err.status).toBe(409);
    expect(err.message).not.toContain(PASSWORD);
  });
});

describe('parser de href', () => {
  const cfg = (): ReturnType<typeof webdavConfig> => webdavConfig();

  test('href com percent-encoding vira caminho decodificado; origem diferente é recusada', () => {
    expect(hrefToPath(`${BASE_PATH}/Videos/Anime/Ep%2001%20%C3%A7.mp4`, cfg())).toBe('/Videos/Anime/Ep 01 ç.mp4');
    expect(hrefToPath(`https://nas.test${BASE_PATH}/Videos/x.mp4`, cfg())).toBe('/Videos/x.mp4');
    expect(hrefToPath(`https://outro.test${BASE_PATH}/Videos/x.mp4`, cfg())).toBeNull();
    expect(hrefToPath('/outro/caminho/x.mp4', cfg())).toBeNull();
    expect(hrefToPath(`${BASE_PATH}/%E0%A4%A`, cfg())).toBeNull();
  });
});
