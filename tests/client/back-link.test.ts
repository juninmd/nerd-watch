import { describe, expect, test } from 'bun:test';
import { backLinkHtml } from '../../src/client/ui/back-link.ts';

describe('backLinkHtml', () => {
  test('destino e rótulo vão escapados (nada vira HTML)', () => {
    const html = backLinkHtml('#/x"><script>', '<b>Listas</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
  });

  test('só marca volta pelo histórico quando pedido; o href segue como reserva', () => {
    expect(backLinkHtml('#/library', 'Voltar', true)).toContain('data-history-back');
    expect(backLinkHtml('#/lists', 'Listas')).not.toContain('data-history-back');
    expect(backLinkHtml('#/lists', 'Listas')).toContain('href="#/lists"');
  });
});
