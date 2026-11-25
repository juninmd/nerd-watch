import { describe, expect, test } from 'bun:test';
import { posterCssUrl } from '../../src/client/ui/poster-css.ts';

describe('posterCssUrl', () => {
  test('URL comum vira url("...") sem alterar nada', () => {
    expect(posterCssUrl('https://archive.org/services/img/x')).toBe('url("https://archive.org/services/img/x")');
  });

  test('aspas e barras invertidas não fecham o url() nem injetam declaração CSS', () => {
    const hostile = 'https://a.test/x").evil{}/*';
    const css = posterCssUrl(hostile);
    expect(css).toBe('url("https://a.test/x\\").evil{}/*")');
    expect(css.startsWith('url("')).toBe(true);
    expect(css.endsWith('")')).toBe(true);
  });
});
