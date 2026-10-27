import { describe, expect, test } from 'bun:test';
import { trailerFrameHtml } from '../src/client/components/trailer-embed.ts';

describe('trailerFrameHtml', () => {
  test('chave válida gera iframe com sandbox', () => {
    const html = trailerFrameHtml('dQw4w9WgXcQ');
    expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('sandbox=');
  });
  test.each(['x" onload="y', 'abc def12', '<b>abcdef', 'a'.repeat(33), 'abc', '', null, undefined])('rejeita %p', (k) => {
    expect(trailerFrameHtml(k)).toBe('');
  });
});
