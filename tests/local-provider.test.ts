import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localSource, registerLocal } from '../src/server/providers/local/source.ts';
import { isInside, configuredRoots, validateLocalRoots } from '../src/server/providers/local/roots.ts';
import { parseRange } from '../src/server/providers/local/range.ts';
import { snapshotRegistry, restoreRegistry } from '../src/server/providers/sources/registry.ts';
import { SourceError } from '../src/server/providers/sources/types.ts';

/*
 * Arquivos de verdade num diretório temporário (criado e apagado pelo teste). Os "ataques" usam junctions de
 * diretório, que o Windows cria sem privilégio de administrador; no Linux/macOS viram symlinks.
 */
let base: string;
let media: string;
let outside: string;
const SIZE = 100;
const BYTES = Buffer.from(Array.from({ length: SIZE }, (_, i) => i));
const snapshot = snapshotRegistry();

const setRoots = (value: string | undefined) => {
  if (value === undefined) delete process.env.LOCAL_MEDIA_DIRS;
  else process.env.LOCAL_MEDIA_DIRS = value;
};

const write = (file: string, data: string | Buffer, mtime: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  utimesSync(file, new Date(mtime), new Date(mtime));
};

const junction = (target: string, link: string) => symlinkSync(target, link, 'junction');

beforeAll(() => {
  registerLocal();
  base = mkdtempSync(path.join(tmpdir(), 'nw-local-'));
  media = path.join(base, 'media');
  outside = path.join(base, 'segredos');
  write(path.join(media, 'Anime', 'Ep 01.mp4'), BYTES, '2026-10-01T10:00:00Z');
  write(path.join(media, 'Anime', 'notas.txt'), 'nada', '2026-10-09T10:00:00Z');
  write(path.join(media, 'Anime', 'Ep 01.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), '2026-10-01T10:00:00Z');
  write(path.join(media, 'Anime', 'Temporada 2', 'T2 01.webm'), 'webm', '2026-10-02T10:00:00Z');
  write(path.join(media, 'Anime', 'Temporada 2', 'Extras', 'bonus.mp4'), 'bonus', '2026-10-03T10:00:00Z');
  write(path.join(media, 'Anime', 'Temporada 2', 'Extras', 'deep', 'fundo-demais.mp4'), 'fundo', '2026-10-04T10:00:00Z');
  write(path.join(outside, 'roubado.mp4'), 'SEGREDO', '2026-10-05T10:00:00Z');
  junction(outside, path.join(media, 'Anime', 'atalho'));
});

afterAll(() => {
  restoreRegistry(snapshot);
  setRoots(undefined);
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  setRoots(media);
});

afterEach(() => {
  setRoots(undefined);
});

const realAnime = async () => path.join(await realpath(media), 'Anime');

describe('raízes (lista de permissão)', () => {
  test('LOCAL_MEDIA_DIRS é separado por path.delimiter; vazios e relativos são ignorados; sem valor a fonte fica desligada', () => {
    setRoots([media, 'relativo/pasta', '', outside].join(path.delimiter));
    expect(configuredRoots()).toEqual([path.resolve(media), path.resolve(outside)]);
    setRoots(undefined);
    expect(configuredRoots()).toEqual([]);
  });

  test('isInside: a própria raiz e filhos entram; irmão com prefixo igual e subida com .. não', () => {
    expect(isInside(media, media)).toBe(true);
    expect(isInside(media, path.join(media, 'a', 'b.mp4'))).toBe(true);
    expect(isInside(media, `${media}-irmao`)).toBe(false);
    expect(isInside(media, path.join(media, '..', 'segredos'))).toBe(false);
    expect(isInside(media, outside)).toBe(false);
  });

  test('validação do campo: caminho relativo, pasta inexistente ou lista vazia são recusados', () => {
    expect(validateLocalRoots('relativo')).not.toBeNull();
    expect(validateLocalRoots(path.join(base, 'nao-existe'))).not.toBeNull();
    expect(validateLocalRoots(`${media}${path.delimiter}`.replace(/\s/g, ''))).toBeNull();
    expect(validateLocalRoots(' ')).not.toBeNull();
  });
});

describe('resolve (adicionar pasta)', () => {
  test('caminho relativo à primeira raiz vira handle com o caminho real e o nome da pasta', async () => {
    expect(await localSource.resolve('Anime')).toEqual({ handle: `local:${await realAnime()}`, name: 'Anime' });
  });

  test('caminho absoluto dentro da raiz também vale', async () => {
    expect((await localSource.resolve(path.join(media, 'Anime'))).name).toBe('Anime');
  });

  test('pasta fora da raiz, subida com .., atalho que escapa e NUL são 400', async () => {
    for (const bad of [outside, '../segredos', 'Anime/atalho', 'Anime\u0000x']) {
      const err = (await localSource.resolve(bad).catch((e) => e)) as SourceError;
      expect(err).toBeInstanceOf(SourceError);
      expect(err.status).toBe(400);
    }
  });

  test('arquivo no lugar de pasta é 400; inexistente é 404; sem raiz configurada é 501', async () => {
    expect(((await localSource.resolve('Anime/Ep 01.mp4').catch((e) => e)) as SourceError).status).toBe(400);
    expect(((await localSource.resolve('Anime/nao-existe').catch((e) => e)) as SourceError).status).toBe(404);
    setRoots(undefined);
    expect(((await localSource.resolve('Anime').catch((e) => e)) as SourceError).status).toBe(501);
  });
});

describe('list (vídeos do canal)', () => {
  test('lista só vídeos, até o nível 3, do mais novo ao mais antigo, com fileRef relativo com /', async () => {
    const items = await localSource.list(`local:${await realAnime()}`);
    expect(items.map((i) => i.fileRef)).toEqual(['Temporada 2/Extras/bonus.mp4', 'Temporada 2/T2 01.webm', 'Ep 01.mp4']);
    expect(items.map((i) => i.caption)).toEqual(['bonus', 'T2 01', 'Ep 01']);
  });

  test('atalhos (junction) para fora da raiz e a pasta de nível 4 nunca aparecem', async () => {
    const items = await localSource.list(`local:${await realAnime()}`);
    expect(items.some((i) => i.fileRef?.includes('roubado'))).toBe(false);
    expect(items.some((i) => i.fileRef?.includes('fundo-demais'))).toBe(false);
  });

  test('pasta do canal que saiu da lista de permissão não lista nada (404)', async () => {
    const handle = `local:${await realAnime()}`;
    setRoots(path.join(base, 'outra-raiz'));
    expect(((await localSource.list(handle).catch((e) => e)) as SourceError).status).toBe(404);
  });
});

describe('play (arquivo com Range, do disco em stream)', () => {
  const handle = async () => `local:${await realAnime()}`;

  test('sem Range devolve 200 com o arquivo inteiro, tipo pela extensão e Accept-Ranges', async () => {
    const res = await localSource.play({ handle: await handle(), fileRef: 'Ep 01.mp4', range: undefined });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe(String(SIZE));
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  test('bytes=0-9 devolve 206 com os 10 primeiros bytes e Content-Range certo', async () => {
    const res = await localSource.play({ handle: await handle(), fileRef: 'Ep 01.mp4', range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${SIZE}`);
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(0, 10))).toBe(true);
  });

  test('bytes=N- (aberto) e bytes=-N (sufixo) funcionam, inclusive sufixo maior que o arquivo', async () => {
    const open = await localSource.play({ handle: await handle(), fileRef: 'Ep 01.mp4', range: 'bytes=90-' });
    expect(open.headers.get('Content-Range')).toBe(`bytes 90-99/${SIZE}`);
    expect(Buffer.from(await open.arrayBuffer()).equals(BYTES.subarray(90))).toBe(true);
    const suffix = await localSource.play({ handle: await handle(), fileRef: 'Ep 01.mp4', range: 'bytes=-5' });
    expect(suffix.headers.get('Content-Range')).toBe(`bytes 95-99/${SIZE}`);
    const huge = await localSource.play({ handle: await handle(), fileRef: 'Ep 01.mp4', range: 'bytes=-500' });
    expect(huge.headers.get('Content-Range')).toBe(`bytes 0-99/${SIZE}`);
  });

  test('faixa fora do arquivo, invertida, múltipla ou malformada é 416 com Content-Range do tamanho', async () => {
    for (const range of ['bytes=100-110', 'bytes=5-2', 'bytes=0-1,5-6', 'bytes=abc', 'bytes=-', 'bytes=-0', 'items=0-1']) {
      const res = await localSource.play({ handle: await handle(), fileRef: 'Ep 01.mp4', range });
      expect(res.status).toBe(416);
      expect(res.headers.get('Content-Range')).toBe(`bytes */${SIZE}`);
    }
  });

  test('parseRange cobre os limites: último byte, primeiro byte e fim exato', () => {
    expect(parseRange('bytes=99-99', SIZE)).toEqual({ kind: 'partial', start: 99, end: 99 });
    expect(parseRange('bytes=0-99', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 });
    expect(parseRange('bytes=0-999999999999999999999', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 });
    expect(parseRange(undefined, SIZE)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  test('fileRef hostil é 404 mesmo com o arquivo existindo: .., caminho absoluto, drive, atalho, não-vídeo', async () => {
    for (const fileRef of ['../segredos/roubado.mp4', '/etc/passwd.mp4', 'C:roubado.mp4', 'atalho/roubado.mp4', 'Ep 01.txt', 'Ep 01.jpg']) {
      const err = (await localSource.play({ handle: await handle(), fileRef, range: undefined }).catch((e) => e)) as SourceError;
      expect(err).toBeInstanceOf(SourceError);
      expect(err.status).toBe(404);
    }
  });

  test('atalho criado DEPOIS do cadastro (troca de link) é recusado na hora da reprodução', async () => {
    const h = await handle();
    const dynamic = path.join(media, 'Anime', 'Temporada 2', 'novo-atalho');
    junction(outside, dynamic);
    const err = (await localSource.play({ handle: h, fileRef: 'Temporada 2/novo-atalho/roubado.mp4', range: undefined }).catch((e) => e)) as SourceError;
    expect(err.status).toBe(404);
  });
});

describe('miniatura de sidecar (sem ffmpeg)', () => {
  const handle = async () => `local:${await realAnime()}`;

  test('<nome>.jpg ao lado do vídeo é devolvido como bytes', async () => {
    const bytes = await localSource.thumb?.({ handle: await handle(), fileRef: 'Ep 01.mp4', thumbnailUrl: null });
    expect(bytes ? Array.from(bytes.slice(0, 3)) : null).toEqual([0xff, 0xd8, 0xff]);
  });

  test('sem sidecar, fileRef nulo ou fora da raiz, não há miniatura', async () => {
    expect(await localSource.thumb?.({ handle: await handle(), fileRef: 'Temporada 2/T2 01.webm', thumbnailUrl: null })).toBeNull();
    expect(await localSource.thumb?.({ handle: await handle(), fileRef: null, thumbnailUrl: null })).toBeNull();
    expect(await localSource.thumb?.({ handle: await handle(), fileRef: 'atalho/roubado.mp4', thumbnailUrl: null })).toBeNull();
  });
});
