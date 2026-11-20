import { describe, expect, test } from 'bun:test';
import { episodeFileIndex } from '../../src/server/torrent/episode-file.ts';

/**
 * Escolha do episódio dentro de um pack: é o que evita abrir o E01 quando o addon entregou o pack
 * inteiro da temporada sem `fileIdx`. Só função pura sobre nomes — nenhum torrent é aberto.
 */

const file = (name: string, length = 1_000_000) => ({ name, length });
const hint = (season: number, episode: number) => ({ season, episode });

describe('episodeFileIndex', () => {
  test('reconhece SxxExx e variações comuns de release', () => {
    const files = [file('Serie.S01E01.1080p.mp4'), file('Serie.S01E02.1080p.mp4'), file('Serie.S03E02.720p.mp4'), file('Serie.1x02.HDTV.mp4'), file('Serie Season 1 Episode 2 DVDRip.mp4')];
    expect(episodeFileIndex(files, hint(1, 2))).toBe(1);
    expect(episodeFileIndex(files, hint(3, 2))).toBe(2);
    expect(episodeFileIndex([files[3] as ReturnType<typeof file>], hint(1, 2))).toBe(0);
    expect(episodeFileIndex([files[4] as ReturnType<typeof file>], hint(1, 2))).toBe(0);
  });

  test('S01E21 não casa com o episódio 2 e S10E02 não casa com a temporada 1', () => {
    expect(episodeFileIndex([file('Serie.S01E21.mp4')], hint(1, 2))).toBeNull();
    expect(episodeFileIndex([file('Serie.S10E02.mp4')], hint(1, 2))).toBeNull();
    expect(episodeFileIndex([file('Serie.S10E02.mp4')], hint(10, 2))).toBe(0);
  });

  test('container que o navegador não toca (mkv) não é escolhido', () => {
    // O engine só serve mp4/m4v/webm: apontar o mkv daria 404 no stream, então a busca o ignora.
    expect(episodeFileIndex([file('Serie.S01E02.mkv')], hint(1, 2))).toBeNull();
  });

  test('ignora o que não é vídeo tocável (legenda, nfo, sample de outro formato)', () => {
    const files = [file('Serie.S01E02.srt'), file('Serie.S01E02.nfo'), file('Serie.S01E02.mp4')];
    expect(episodeFileIndex(files, hint(1, 2))).toBe(2);
  });

  test('entre duas versões do mesmo episódio fica o menor vídeo (começa a tocar antes)', () => {
    const files = [file('Serie.S01E02.1080p.mp4', 40_000_000), file('Serie.S01E02.720p.mp4', 12_000_000)];
    expect(episodeFileIndex(files, hint(1, 2))).toBe(1);
  });

  test('sem correspondência devolve null (quem chama cai no heurístico padrão)', () => {
    expect(episodeFileIndex([file('Filme.2024.1080p.mp4')], hint(1, 2))).toBeNull();
    expect(episodeFileIndex([], hint(1, 2))).toBeNull();
    expect(episodeFileIndex([file('Serie.S02E01.mp4')], hint(1, 2))).toBeNull();
  });
});
