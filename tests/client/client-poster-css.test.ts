import { describe, expect, test } from 'bun:test';
import { initials, posterCssUrl, posterSrcset, titleHue } from '../../src/client/ui/card.ts';

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

describe('posterSrcset', () => {
  test('pôster da TMDB ganha as três larguras, para tela de alta densidade receber a imagem maior', () => {
    expect(posterSrcset('https://image.tmdb.org/t/p/w342/abc.jpg')).toBe(
      'https://image.tmdb.org/t/p/w342/abc.jpg 342w, https://image.tmdb.org/t/p/w500/abc.jpg 500w, https://image.tmdb.org/t/p/w780/abc.jpg 780w',
    );
  });

  test('outras origens têm um tamanho só; URL fora do formato não vira srcset', () => {
    for (const url of [
      'https://archive.org/services/img/night_of_the_living_dead',
      '/api/telegram/channels/x/photo',
      'https://image.tmdb.org/t/p/original/abc.jpg',
      'https://image.tmdb.org/t/p/w342/abc.jpg 9999w, https://evil.example/x.jpg',
      'http://image.tmdb.org/t/p/w342/abc.jpg',
    ]) {
      expect(posterSrcset(url)).toBeNull();
    }
  });
});

describe('titleHue', () => {
  test('o mesmo título dá sempre o mesmo matiz, dentro de 0..359', () => {
    expect(titleHue('Maré Alta')).toBe(titleHue('Maré Alta'));
    for (const t of ['', 'A', 'Horizonte Vermelho', '日本語のタイトル', 'x'.repeat(5000)]) {
      const hue = titleHue(t);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  test('títulos diferentes se espalham pelo círculo de cores', () => {
    const hues = new Set(['Maré Alta', 'Horizonte Vermelho', 'Arquivo Morto', 'O Último Farol', 'Duas Luas', 'Feira Livre'].map(titleHue));
    expect(hues.size).toBeGreaterThanOrEqual(5);
  });
});
