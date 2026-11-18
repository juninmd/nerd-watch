import { describe, expect, test } from 'bun:test';
import { compareSources, pickTvmazeMatch, statusGroup } from '../../src/server/compare/source-compare.ts';

describe('statusGroup', () => {
  test('agrupa vocabulários diferentes', () => {
    expect(statusGroup('Returning Series')).toBe('running');
    expect(statusGroup('Running')).toBe('running');
    expect(statusGroup('Canceled')).toBe('ended');
    expect(statusGroup('To Be Determined')).toBeNull();
    expect(statusGroup(null)).toBeNull();
  });
});

describe('compareSources', () => {
  test('mesma coisa com palavras diferentes não é divergência', () => {
    const rows = compareSources({ status: 'Returning Series', year: '2022', rating: 8.4 }, { status: 'Running', year: '2022', rating: 8.0 });
    expect(rows.every((r) => !r.differs)).toBe(true);
  });
  test('status e estreia discordantes são marcados; status indefinido não', () => {
    const rows = compareSources({ status: 'Ended', year: '2019', rating: 7 }, { status: 'Running', year: '2020', rating: 5.5 });
    expect(rows.map((r) => r.differs)).toEqual([true, true, true]);
    const tbd = compareSources({ status: 'Ended', year: null, rating: null }, { status: 'To Be Determined', year: '2020', rating: null });
    expect(tbd.map((r) => r.differs)).toEqual([false, false, false]);
  });
});

describe('pickTvmazeMatch', () => {
  const c = [{ name: 'Fallout', year: '1997' }, { name: 'Fallout', year: '2024' }, { name: 'Other', year: '2024' }];
  test('exige nome e ano compatíveis', () => {
    expect(pickTvmazeMatch('Fallout', '2024', c)?.year).toBe('2024');
    expect(pickTvmazeMatch('fállout', '2024', c)?.year).toBe('2024');
    expect(pickTvmazeMatch('Fallout', '2010', c)).toBeNull();
    expect(pickTvmazeMatch('Inexistente', '2024', c)).toBeNull();
  });
});
