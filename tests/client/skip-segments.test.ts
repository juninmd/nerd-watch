import { describe, expect, test } from 'bun:test';
import { activeSegment, creditsStart } from '../../src/client/player/skip-segments.ts';

const LIST = [
  { kind: 'intro' as const, start: 30, end: 120 },
  { kind: 'credits' as const, start: 1380, end: 1440 },
];

describe('trechos de pular no player', () => {
  test('botão aparece dentro do trecho e some no último segundo', () => {
    expect(activeSegment(LIST, 29)).toBeNull();
    expect(activeSegment(LIST, 30)?.kind).toBe('intro');
    expect(activeSegment(LIST, 118.9)?.kind).toBe('intro');
    expect(activeSegment(LIST, 119.5)).toBeNull();
  });

  test('créditos finais iniciam a contagem; créditos no começo do vídeo não', () => {
    expect(creditsStart(LIST, 1440)).toBe(1380);
    expect(creditsStart([{ kind: 'credits', start: 10, end: 60 }], 1440)).toBeNull();
    expect(creditsStart([], 1440)).toBeNull();
  });
});
