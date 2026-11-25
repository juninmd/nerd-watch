import { describe, expect, test } from 'bun:test';
import { compareSummary } from '../../src/client/catalog/source-compare-card.tsx';

const row = (differs: boolean) => ({ field: 'f', label: 'L', tmdb: 'a', tvmaze: differs ? 'b' : 'a', differs });

describe('compareSummary', () => {
  test('conta as divergências, no singular e no plural', () => {
    expect(compareSummary([row(true), row(false)])).toBe('1 divergência em destaque.');
    expect(compareSummary([row(true), row(true)])).toBe('2 divergências em destaque.');
  });
  test('quando concordam, diz isso', () => {
    expect(compareSummary([row(false)])).toContain('concordam');
  });
});
