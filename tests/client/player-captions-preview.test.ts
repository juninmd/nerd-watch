import { describe, expect, test } from 'bun:test';
import { captionStyleVars } from '../../src/client/player/player-captions-prefs.ts';

describe('prévia do estilo da legenda', () => {
  test('a prévia usa as mesmas variáveis que o vídeo', () => {
    expect(captionStyleVars({ size: 'lg', background: 50, color: 'yellow' })).toEqual({
      '--nw-cue-scale': '1.3',
      '--nw-cue-bg': '0.5',
      '--nw-cue-color': '#ffe600',
    });
  });
});
