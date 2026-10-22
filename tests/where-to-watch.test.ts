import { describe, expect, test } from 'bun:test';
import { whereToWatchHtml } from '../src/client/components/where-to-watch.ts';

const empty = { link: null, flatrate: [], rent: [], buy: [] };

describe('whereToWatchHtml', () => {
  test('sem nenhum serviço explica em vez de ficar vazio, e não oferece link', () => {
    const html = whereToWatchHtml(empty);
    expect(html).toContain('Nenhum streaming listado');
    expect(html).not.toContain('where-link');
  });

  test('agrupa por tipo de acesso com a contagem e omite grupos vazios', () => {
    const html = whereToWatchHtml({ ...empty, flatrate: [{ name: 'A', logoUrl: null }, { name: 'B', logoUrl: null }], buy: [{ name: 'C', logoUrl: null }] });
    expect(html).toContain('Incluso na assinatura (2)');
    expect(html).toContain('Comprar (1)');
    expect(html).not.toContain('Alugar');
  });

  test('escapa nomes e links vindos da API (sem HTML injetado)', () => {
    const html = whereToWatchHtml({ ...empty, flatrate: [{ name: '<img src=x onerror=alert(1)>', logoUrl: null }], link: 'https://x.test/?a="b' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).not.toContain('"b"');
  });
});
