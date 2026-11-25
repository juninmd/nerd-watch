import { describe, expect, test } from 'bun:test';
import { progressPct, seasonRows } from '../../src/client/catalog/title-side-view.tsx';
import { ageLabel, groupCredits, personFacts } from '../../src/client/catalog/person-facts.ts';

const season = (number: number, episodeOrder: number | null, premiereDate: string | null = null, endDate: string | null = null) => ({
  number,
  name: null,
  episodeOrder,
  premiereDate,
  endDate,
  imageUrl: null,
  summary: null,
  channel: null,
});

describe('title-side-view', () => {
  test('anel de progresso arredonda e não passa de 100%', () => {
    expect(progressPct(3, 207)).toBe(1);
    expect(progressPct(500, 207)).toBe(100);
    expect(progressPct(0, 0)).toBeNull();
  });

  test('temporadas usam a contagem real e escondem série de temporada única', () => {
    const rows = seasonRows({ seasons: [season(1, 25, '1998-09-21', '1999-05-17'), season(2, 25), season(0, 3)] }, new Map([[1, 25], [2, 12]]));
    expect(rows.map((r) => r.number)).toEqual([1, 2]);
    expect(rows[0]?.years).toBe('1998–99');
    expect(rows[1]?.share).toBeCloseTo(0.48);
    expect(seasonRows({ seasons: [season(1, 10)] }, new Map())).toEqual([]);
  });
});

describe('person-facts', () => {
  test('idade hoje e ao falecer', () => {
    const today = new Date('2026-11-20T12:00:00');
    expect(ageLabel({ birthday: '1969-01-27', deathday: null }, today)).toBe('57 anos');
    expect(ageLabel({ birthday: '1927-06-08', deathday: '2020-05-11' }, today)).toBe('92 anos ao falecer');
    expect(ageLabel({ birthday: null, deathday: null }, today)).toBeNull();
    expect(personFacts({ id: 1, name: 'A', imageUrl: null, country: 'United States', birthday: null, deathday: null, gender: null })).toEqual(['United States']);
  });

  test('créditos agrupam papéis por série e tiram a série aberta', () => {
    const credits = [
      { showId: 1, showName: 'King', role: 'Doug', voice: false },
      { showId: 2, showName: 'Penguins', role: 'Marlene', voice: true },
      { showId: 2, showName: 'Penguins', role: 'Marlene', voice: true },
      { showId: 3, showName: 'Kevin', role: null, voice: false },
    ];
    expect(groupCredits(credits, 1)).toEqual([
      { showId: 2, name: 'Penguins', roles: ['Marlene (voz)'] },
      { showId: 3, name: 'Kevin', roles: [] },
    ]);
  });
});
