import { describe, expect, test } from 'bun:test';
import type { TitleStreamsDto } from '../../src/client/api/stremio.ts';
import { hdStill, neighborEpisode, pickStream, playPath } from '../../src/client/player/episode-play-model.ts';

type S = TitleStreamsDto['addons'][number]['streams'][number];
const s = (index: number, kind: S['kind'], description: string): S =>
  ({ index, kind, title: description, description, url: kind === 'torrent' ? null : 'https://cdn.example.test/v.mp4', infoHash: null, fileIdx: null, filename: null }) as S;
const group = (addonId: string, streams: S[]) => ({ addonId, name: addonId, host: `${addonId}.example.test`, type: 'series', contentId: 'tt1:1:1', error: null, streams });

const DTO = {
  imdbId: 'tt1',
  addons: [
    group('torrentio', [s(0, 'error', 'Token expirado'), s(1, 'torrent', 'X.720p 👤 50'), s(2, 'torrent', 'X.1080p 👤 400')]),
    group('direct', [s(0, 'external', 'Abrir no site'), s(1, 'url', 'Episódio 1080p')]),
  ],
} as TitleStreamsDto;

describe('episode-play-model', () => {
  test('capa em alta troca só o tamanho no caminho da TVmaze e da TMDB', () => {
    expect(hdStill('https://static.tvmaze.com/uploads/images/medium_landscape/1/4388.jpg')).toBe('https://static.tvmaze.com/uploads/images/original_untouched/1/4388.jpg');
    expect(hdStill('https://image.tmdb.org/t/p/w342/abc.jpg')).toBe('https://image.tmdb.org/t/p/w1280/abc.jpg');
    // Outro host não é reescrito: nada de inventar URL.
    expect(hdStill('https://evil.example.test/medium_landscape/1.jpg')).toBe('https://evil.example.test/medium_landscape/1.jpg');
    expect(hdStill(null)).toBeNull();
  });

  test('o stream clicado vence; aviso e link externo nunca começam a tocar', () => {
    expect(pickStream(DTO, null, { addonId: 'torrentio', index: 2 })).toEqual({ addonId: 'torrentio', index: 2 });
    expect(pickStream(DTO, null, { addonId: 'torrentio', index: 0 })).toEqual({ addonId: 'torrentio', index: 1 });
    expect(pickStream(DTO, null, { addonId: 'direct', index: 0 })).toEqual({ addonId: 'torrentio', index: 1 });
  });

  test('próximo episódio repete o addon e a resolução da última escolha', () => {
    expect(pickStream(DTO, { addonId: 'torrentio', height: 1080 })).toEqual({ addonId: 'torrentio', index: 2 });
    expect(pickStream(DTO, { addonId: 'torrentio', height: 2160 })).toEqual({ addonId: 'torrentio', index: 1 });
    expect(pickStream(DTO, { addonId: 'sumiu', height: 1080 })).toEqual({ addonId: 'torrentio', index: 2 });
    expect(pickStream({ imdbId: 'tt1', addons: [group('x', [s(0, 'error', 'falhou')])] } as TitleStreamsDto, null)).toBeNull();
  });

  test('vizinho atravessa temporadas e pula especiais e temporadas vazias', () => {
    const seasons = [
      { number: 0, count: 3 },
      { number: 1, count: 2 },
      { number: 2, count: 0 },
      { number: 3, count: 5 },
    ];
    expect(neighborEpisode(seasons, 1, 1, 1)).toEqual({ season: 1, episode: 2 });
    expect(neighborEpisode(seasons, 1, 2, 1)).toEqual({ season: 3, episode: 1 });
    expect(neighborEpisode(seasons, 3, 1, -1)).toEqual({ season: 1, episode: 2 });
    expect(neighborEpisode(seasons, 1, 1, -1)).toBeNull();
    expect(neighborEpisode(seasons, 3, 5, 1)).toBeNull();
    expect(neighborEpisode(seasons, 9, 1, 1)).toBeNull();
    // Numeração com buraco (sem o 2): segue os números reais da temporada.
    expect(neighborEpisode([{ number: 1, count: 3 }], 1, 1, 1, [1, 3, 4])).toEqual({ season: 1, episode: 3 });
    expect(neighborEpisode([{ number: 1, count: 3 }], 1, 3, -1, [1, 3, 4])).toEqual({ season: 1, episode: 1 });
  });

  test('caminho do player', () => {
    expect(playPath('tvmaze', '552', 1, 4)).toBe('/play/tvmaze/552/1/4');
  });
});
