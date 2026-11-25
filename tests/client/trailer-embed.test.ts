import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrailerFrame } from '../../src/client/player/trailer-embed.tsx';

const trailerFrameHtml = (key: string | null | undefined): string =>
  renderToStaticMarkup(createElement(TrailerFrame, { trailerKey: key }));

describe('TrailerFrame', () => {
  test('chave válida gera iframe com sandbox e alvo focável do botão "Trailer"', () => {
    const html = trailerFrameHtml('dQw4w9WgXcQ');
    expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('sandbox=');
    expect(html).toContain('id="trailer"');
    expect(html).toContain('tabindex="-1"');
  });
  test.each(['x" onload="y', 'abc def12', '<b>abcdef', 'a'.repeat(33), 'abc', '', null, undefined])(
    'rejeita %p',
    (k) => {
      expect(trailerFrameHtml(k)).toBe('');
    },
  );
});
