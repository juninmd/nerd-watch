import { describe, expect, test } from 'bun:test';
import { countStreamKinds, DEFAULT_STREAM_FILTER, filterTitleStreams, streamFacts } from '../../src/client/addons/stream-filter.ts';
import type { TitleStreamDto, TitleStreamsDto } from '../../src/client/api/stremio.ts';

const s = (kind: TitleStreamDto['kind'], description: string): TitleStreamDto =>
  ({ kind, title: description, description, url: kind === 'torrent' ? null : 'https://cdn.example.test/v.mp4', infoHash: null, fileIdx: null, filename: null }) as TitleStreamDto;

const DTO: TitleStreamsDto = {
  imdbId: 'tt0165581',
  addons: [
    {
      addonId: 'torrentio',
      name: 'Torrentio',
      host: 'torrentio.example.test',
      type: 'series',
      contentId: 'tt0165581:1:1',
      error: null,
      streams: [s('torrent', 'Show.S01E01.720p 👤 900'), s('torrent', 'Show.S01E01.2160p 👤 12'), s('torrent', 'Show.S01E01.1080p 👤 340'), s('error', 'Token expirado')],
    },
    { addonId: 'direct', name: 'Direto', host: 'd.example.test', type: 'series', contentId: 'x', error: null, streams: [s('url', 'Episódio 1080p'), s('external', 'Abrir no site')] },
  ],
};

describe('stream-filter', () => {
  test('lê resolução e seeds pelos mesmos selos do cartão', () => {
    expect(streamFacts(s('torrent', 'X.2160p 👤 12'))).toEqual({ height: 2160, seeds: 12 });
    expect(streamFacts(s('url', 'sem dados'))).toEqual({ height: 0, seeds: null });
  });

  test('padrão mantém tudo, inclusive o aviso do addon, sem alterar o DTO', () => {
    const out = filterTitleStreams(DTO, DEFAULT_STREAM_FILTER);
    expect(out.addons[0]?.streams).toHaveLength(4);
    expect(out).not.toBe(DTO);
  });

  test('filtra por tipo e esconde o aviso fora de "todos"', () => {
    const p2p = filterTitleStreams(DTO, { ...DEFAULT_STREAM_FILTER, kind: 'p2p' });
    expect(p2p.addons[0]?.streams).toHaveLength(3);
    expect(p2p.addons[1]?.streams).toHaveLength(0);
    const direct = filterTitleStreams(DTO, { ...DEFAULT_STREAM_FILTER, kind: 'direct' });
    expect(direct.addons[1]?.streams.map((x) => x.kind)).toEqual(['url']);
  });

  test('qualidade mínima e ordem por seeds ou qualidade dentro de cada addon', () => {
    const hd = filterTitleStreams(DTO, { kind: 'p2p', minHeight: 1080, sort: 'seeds' });
    expect(hd.addons[0]?.streams.map((x) => streamFacts(x).seeds)).toEqual([340, 12]);
    const best = filterTitleStreams(DTO, { kind: 'p2p', minHeight: 0, sort: 'quality' });
    expect(best.addons[0]?.streams.map((x) => streamFacts(x).height)).toEqual([2160, 1080, 720]);
    expect(DTO.addons[0]?.streams.map((x) => x.description)).toEqual(['Show.S01E01.720p 👤 900', 'Show.S01E01.2160p 👤 12', 'Show.S01E01.1080p 👤 340', 'Token expirado']);
  });

  test('contagem por tipo ignora avisos', () => {
    expect(countStreamKinds(DTO)).toEqual({ all: 5, p2p: 3, direct: 1, external: 1 });
  });
});
