import { describe, expect, test } from 'bun:test';
import { episodeLabel, listEpisodes, parseImdbEpisodeId } from '../../src/client/addons/addon-episode.ts';
import type { AddonMetaDto } from '../../src/client/api/stremio.ts';

const baseMeta: AddonMetaDto = {
  id: 'tt0903747',
  type: 'series',
  name: 'Breaking Bad',
  poster: null,
  year: '2008',
  background: null,
  description: '',
  runtime: '',
  genres: [],
  videos: [],
};

describe('addon-episode', () => {
  test('parseImdbEpisodeId extrai imdbId, temporada e episódio', () => {
    expect(parseImdbEpisodeId('tt0903747:1:2')).toEqual({ imdbId: 'tt0903747', season: 1, episode: 2 });
    expect(parseImdbEpisodeId('tt0903747')).toEqual({ imdbId: 'tt0903747', season: null, episode: null });
    expect(parseImdbEpisodeId('kitsu:12345:1')).toBeNull();
    expect(parseImdbEpisodeId('')).toBeNull();
  });

  test('episodeLabel formata temporada, episódio e título', () => {
    expect(episodeLabel({ id: '1', title: 'Pilot', season: 1, episode: 1 })).toBe('T1 E1 · Pilot');
    expect(episodeLabel({ id: '2', title: 'Especial', season: null, episode: 5 })).toBe('E5 · Especial');
    expect(episodeLabel({ id: '3', title: 'OVA', season: null, episode: null })).toBe('OVA');
  });

  test('listEpisodes mantém vídeos de série mesmo quando o addon omite números de temporada/episódio', () => {
    const withNums = listEpisodes({
      ...baseMeta,
      videos: [
        { id: 'tt0903747:1:1', title: 'Pilot', season: 1, episode: 1 },
        { id: 'extra', title: 'Trailer', season: null, episode: null },
      ],
    });
    expect(withNums).toHaveLength(1);
    expect(withNums[0]?.id).toBe('tt0903747:1:1');

    const unnumbered = listEpisodes({
      ...baseMeta,
      videos: [{ id: 'ep/1', title: 'Episódio 1', season: null, episode: null }],
    });
    expect(unnumbered).toHaveLength(1);
    expect(unnumbered[0]?.id).toBe('ep/1');

    const movieVideos = listEpisodes({
      ...baseMeta,
      type: 'movie',
      videos: [{ id: 'trailer', title: 'Trailer', season: null, episode: null }],
    });
    expect(movieVideos).toHaveLength(0);
  });
});
