import { describe, expect, test } from 'bun:test';
import { initials, posterCssUrl } from '../src/client/components/card.ts';

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

describe('initials (placeholder de pôster)', () => {
  test('duas primeiras letras em caixa-alta, ignorando espaços extras', () => {
    expect(initials('  sita sings   the blues ')).toBe('SS');
    expect(initials('Utopia')).toBe('U');
  });

  test('título vazio não quebra o placeholder', () => {
    expect(initials('')).toBe('');
  });
});
