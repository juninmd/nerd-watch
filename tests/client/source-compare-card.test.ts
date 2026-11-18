import { describe, expect, test } from 'bun:test';
import { compareHtml } from '../../src/client/catalog/source-compare-card.ts';

describe('compareHtml', () => {
  test('sem correspondência, explica', () => {
    expect(compareHtml({ match: null, rows: [] })).toContain('Não achei');
  });
  test('destaca divergência, escapa texto e linka a TVmaze', () => {
    const html = compareHtml({ match: { id: '12', name: 'X' }, rows: [{ field: 'status', label: 'Status', tmdb: 'Encerrada', tvmaze: '<b>Em exibição</b>', differs: true }] });
    expect(html).toContain('class="is-diff"');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('1 divergência em destaque');
    expect(html).toContain('#/title/tvmaze/tv/12');
  });
  test('quando concordam, diz isso', () => {
    expect(compareHtml({ match: { id: '1', name: 'X' }, rows: [{ field: 'year', label: 'Estreia', tmdb: '2020', tvmaze: '2020', differs: false }] })).toContain('concordam');
  });
});
