import { describe, expect, test } from 'bun:test';
import type { TvmazeCastMember } from '../../src/client/api/index.ts';
import { CAST_PREVIEW, castSideHtml, progressRingHtml, seasonsSideHtml } from '../../src/client/catalog/title-side-view.ts';
import { ageLabel, groupCredits, personFacts } from '../../src/client/catalog/person-facts.ts';

const member = (id: number, name: string, character: string | null = 'Doug'): TvmazeCastMember => ({
  person: { id, name, imageUrl: null, country: null, birthday: null, deathday: null, gender: null },
  character: character ? { name: character, imageUrl: null } : null,
  voice: false,
  self: false,
});

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
  test('elenco escapa nome e personagem e mostra só a prévia de início', () => {
    const cast = Array.from({ length: CAST_PREVIEW + 3 }, (_, i) => member(i + 1, i === 0 ? '<img onerror=x>' : `Ator ${i}`, i === 0 ? '"><script>' : 'Papel'));
    const html = castSideHtml(cast);
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('<script>');
    expect(html.match(/data-more hidden/g)).toHaveLength(3);
    expect(html).toContain('Ver elenco completo (+3)');
    expect(html).toContain('data-person="1"');
  });

  test('elenco curto não tem botão de expandir; vazio some', () => {
    expect(castSideHtml([member(1, 'A')])).not.toContain('data-cast-more');
    expect(castSideHtml([])).toBe('');
  });

  test('anel de progresso arredonda e não passa de 100%', () => {
    expect(progressRingHtml(3, 207, null)).toContain('<strong>1%</strong>');
    expect(progressRingHtml(500, 207, null)).toContain('<strong>100%</strong>');
    expect(progressRingHtml(0, 0, null)).toBe('');
    expect(progressRingHtml(1, 2, '<b>T1</b>')).not.toContain('<b>');
  });

  test('temporadas usam a contagem real e escondem série de temporada única', () => {
    const html = seasonsSideHtml({ seasons: [season(1, 25, '1998-09-21', '1999-05-17'), season(2, 25), season(0, 3)] }, new Map([[1, 25], [2, 12]]));
    expect(html).toContain('data-season-jump="1"');
    expect(html).toContain('1998–99');
    expect(html).toContain('width:48%');
    expect(html).not.toContain('data-season-jump="0"');
    expect(seasonsSideHtml({ seasons: [season(1, 10)] }, new Map())).toBe('');
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
