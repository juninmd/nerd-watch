import { describe, expect, test } from 'bun:test';
import { htmlToText, httpsUrlOrNull } from '../src/server/catalog-text.ts';
import { createRateLimiter, RateLimitExceededError } from '../src/server/rate-limit.ts';

describe('htmlToText', () => {
  test('troca <br> por quebra de linha e remove as demais tags', () => {
    expect(htmlToText('Primeira linha.<br><br>Segunda <i>linha</i>.')).toBe('Primeira linha.\n\nSegunda linha.');
  });

  test('um <script> vira texto comum: a marcação nunca sobrevive à conversão', () => {
    const out = htmlToText('<script>alert(1)</script>Olá');
    expect(out).toBe('alert(1)Olá');
    expect(out).not.toContain('<script');
  });

  test('decodifica entidades básicas e não decodifica duas vezes', () => {
    expect(htmlToText('A &amp; B &lt;x&gt; &quot;q&quot; &#39;a&#39;')).toBe(`A & B <x> "q" 'a'`);
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });

  test('vazio, null e só-espaço viram null', () => {
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText('')).toBeNull();
    expect(htmlToText('  <br>  ')).toBeNull();
  });
});

describe('httpsUrlOrNull', () => {
  test('aceita https simples', () => {
    expect(httpsUrlOrNull('https://static.example.test/img/1.jpg')).toBe('https://static.example.test/img/1.jpg');
  });

  test('recusa http, javascript:, data: e credenciais embutidas', () => {
    expect(httpsUrlOrNull('http://static.example.test/a.jpg')).toBeNull();
    expect(httpsUrlOrNull('javascript:alert(1)')).toBeNull();
    expect(httpsUrlOrNull('data:image/png;base64,AAAA')).toBeNull();
    expect(httpsUrlOrNull('https://user:pass@static.example.test/a.jpg')).toBeNull();
  });

  test('recusa aspas, parênteses e espaços que escapariam do url(\'...\') do cliente', () => {
    expect(httpsUrlOrNull("https://static.example.test/a'b.jpg")).toBeNull();
    expect(httpsUrlOrNull('https://static.example.test/a)b.jpg')).toBeNull();
    expect(httpsUrlOrNull('https://static.example.test/a b.jpg')).toBeNull();
  });

  test('entradas hostis ou de tipo errado viram null sem lançar', () => {
    expect(httpsUrlOrNull(undefined)).toBeNull();
    expect(httpsUrlOrNull(42)).toBeNull();
    expect(httpsUrlOrNull('')).toBeNull();
    expect(httpsUrlOrNull('not a url')).toBeNull();
    expect(httpsUrlOrNull(`https://x.test/${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('createRateLimiter', () => {
  test('deixa passar até o máximo na janela e recusa a seguinte', () => {
    const now = 0;
    const limiter = createRateLimiter('Teste', 2, 1000, () => now);
    limiter.acquire();
    limiter.acquire();
    expect(() => limiter.acquire()).toThrow(RateLimitExceededError);
  });

  test('libera de novo quando as chamadas saem da janela', () => {
    let now = 0;
    const limiter = createRateLimiter('Teste', 1, 1000, () => now);
    limiter.acquire();
    now = 999;
    expect(() => limiter.acquire()).toThrow(RateLimitExceededError);
    now = 1000;
    expect(() => limiter.acquire()).not.toThrow();
  });

  test('a mensagem diz qual serviço estourou, sem detalhes internos', () => {
    const limiter = createRateLimiter('AniList', 0, 1000);
    try {
      limiter.acquire();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect((err as Error).message).toContain('AniList');
    }
  });
});
