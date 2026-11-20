import { describe, expect, test } from 'bun:test';
import type { TitleStreamsDto } from '../../src/client/api/stremio.ts';
import { findAddonStream } from '../../src/client/addons/stream-lookup.ts';

const stream = (index: number, title: string): TitleStreamsDto['addons'][number]['streams'][number] => ({
  index,
  kind: 'url',
  title,
  url: `https://cdn.example.com/${index}.mp4`,
  infoHash: null,
  fileIdx: null,
  filename: null,
});

const dto: TitleStreamsDto = {
  imdbId: 'tt1',
  addons: [
    { addonId: 'a', name: 'A', host: 'a.example.com', type: 'movie', contentId: 'tt1', error: null, streams: [stream(0, 'um'), stream(1, 'dois')] },
    { addonId: 'b', name: 'B', host: 'b.example.com', type: 'movie', contentId: 'tt1', error: null, streams: [stream(0, 'b')] },
  ],
};

describe('findAddonStream', () => {
  test('resolve pelo addon e pela posição da lista, não pela posição na tela', () => {
    expect(findAddonStream(dto, 'a', 1)?.stream.title).toBe('dois');
    expect(findAddonStream(dto, 'b', 0)?.stream.title).toBe('b');
  });

  test('addon desconhecido, índice inexistente ou inválido não resolve', () => {
    expect(findAddonStream(dto, 'x', 0)).toBeNull();
    expect(findAddonStream(dto, 'a', 9)).toBeNull();
    expect(findAddonStream(dto, 'a', Number.NaN)).toBeNull();
    expect(findAddonStream(dto, undefined, 0)).toBeNull();
  });
});
