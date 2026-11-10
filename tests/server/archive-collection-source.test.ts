import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setArchiveCollectionFetchForTests } from '../../src/server/providers/archive-collection/api.ts';
import { archiveCollectionSource, parseCollectionInput } from '../../src/server/providers/archive-collection/source.ts';
import { SourceError } from '../../src/server/providers/sources/types.ts';

let calls: string[] = [];
let respond: (url: string) => Response = () => new Response('', { status: 500 });

beforeEach(() => {
  calls = [];
  setArchiveCollectionFetchForTests(async (url) => {
    calls.push(url);
    return respond(url);
  });
});
afterEach(() => setArchiveCollectionFetchForTests());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const errorOf = async (promise: Promise<unknown>): Promise<SourceError> => {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SourceError) return err;
    throw err;
  }
  throw new Error('esperava um SourceError');
};

describe('parseCollectionInput', () => {
  test('id cru e link de details', () => {
    expect(parseCollectionInput('prelinger')).toBe('prelinger');
    expect(parseCollectionInput('https://archive.org/details/prelinger')).toBe('prelinger');
  });
  test('recusa sintaxe de busca, outro host, http e porta', () => {
    for (const bad of ['a) OR (b', 'foo bar', 'http://archive.org/details/x', 'https://evil.com/details/x', 'https://archive.org:81/details/x', 'https://archive.org/search?q=x', '']) {
      expect(parseCollectionInput(bad)).toBeNull();
    }
  });
});

describe('source', () => {
  test('resolve exige mediatype collection', async () => {
    respond = () => json({ result: { mediatype: 'collection', title: 'Prelinger' } });
    expect(await archiveCollectionSource.resolve('prelinger')).toEqual({ handle: 'archive:prelinger', name: 'Prelinger' });
    respond = () => json({ result: { mediatype: 'movies', title: 'Filme' } });
    expect((await errorOf(archiveCollectionSource.resolve('filme'))).status).toBe(400);
    respond = () => json({});
    expect((await errorOf(archiveCollectionSource.resolve('nada'))).status).toBe(404);
  });

  test('list lê título (string ou array), ignora ids ruins e para na página curta', async () => {
    respond = () =>
      json({
        response: {
          docs: [
            { identifier: 'item_1', title: ['Um'], publicdate: '2024-01-02T03:04:05Z' },
            { identifier: 'bad id', title: 'x' },
            { identifier: 'item2' },
          ],
        },
      });
    const items = await archiveCollectionSource.list('archive:prelinger');
    expect(items.map((i) => [i.fileRef, i.caption])).toEqual([
      ['item_1', 'Um'],
      ['item2', 'item2'],
    ]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0] ?? '').searchParams.get('q')).toBe('collection:(prelinger) AND mediatype:(movies)');
  });

  test('embed, play e handle inválido', async () => {
    expect(archiveCollectionSource.embedUrl?.('item_1')).toBe('https://archive.org/embed/item_1');
    expect(archiveCollectionSource.embedUrl?.('a/b')).toBeNull();
    expect((await errorOf(archiveCollectionSource.play({ handle: 'h', fileRef: 'x', range: undefined }))).status).toBe(501);
    expect((await errorOf(archiveCollectionSource.list('archive:a b'))).status).toBe(400);
  });

  test('thumb segue um redirect dentro de archive.org e recusa fora', async () => {
    respond = (url) =>
      url.includes('services/img') ? new Response(null, { status: 302, headers: { location: 'https://ia800.us.archive.org/t.jpg' } }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    expect(await archiveCollectionSource.thumb?.({ handle: 'h', fileRef: 'item_1', thumbnailUrl: null })).toEqual(new Uint8Array([1, 2, 3]));
    respond = () => new Response(null, { status: 302, headers: { location: 'https://evil.com/t.jpg' } });
    expect(await archiveCollectionSource.thumb?.({ handle: 'h', fileRef: 'item_1', thumbnailUrl: null })).toBeNull();
  });
});
