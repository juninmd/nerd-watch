import { describe, expect, test } from 'bun:test';
import { MEDIA_NAME_CORPUS, MEDIA_NAME_KNOWN_LIMITS } from './fixtures/media-name-corpus.ts';
import { parseMediaName } from '../src/server/media-name/parse.ts';

/** Título, temporada e episódio são a base do casamento com TMDB: um erro aqui vira progresso marcado no título errado. */
describe('parseMediaName: corpus sintético', () => {
  for (const c of MEDIA_NAME_CORPUS) {
    test(JSON.stringify(c.input), () => {
      expect(parseMediaName(c.input, c.opts)).toEqual(c.expect);
    });
  }
});

describe('parseMediaName: limitações conhecidas (pinadas, mudança aparece aqui)', () => {
  for (const c of MEDIA_NAME_KNOWN_LIMITS) {
    test(JSON.stringify(c.input), () => {
      expect(parseMediaName(c.input, c.opts)).toEqual(c.expect);
    });
  }
});

describe('parseMediaName: propriedades', () => {
  test('é determinístico: mesma entrada, mesma saída', () => {
    const input = '[Grupo] Serie Teste S01E02 1080p WEB-DL';
    expect(parseMediaName(input)).toEqual(parseMediaName(input));
  });

  test('o título nunca carrega tag, marcador de episódio nem ano achado', () => {
    for (const c of MEDIA_NAME_CORPUS) {
      const { title, year, season, episode } = parseMediaName(c.input, c.opts);
      expect(title).not.toMatch(/\b(?:1080p|720p|480p|2160p|WEB-DL|BluRay|HDTV)\b/i);
      if (year !== undefined) expect(title.split(' ')).not.toContain(String(year));
      if (season !== undefined && episode !== undefined) expect(title).not.toMatch(/S\d{2}E\d{2}/i);
    }
  });

  test('entradas hostis (vazias, binárias, muito longas) não lançam e devolvem título string', () => {
    const hostile = [
      '\u0000\u0007',
      '�'.repeat(50),
      '[[[(((',
      ')))]]]',
      `${'Palavra '.repeat(400)}S01E01`,
      '.'.repeat(200),
      '-'.repeat(100),
    ];
    for (const input of hostile) expect(typeof parseMediaName(input).title).toBe('string');
  });
});
