import { describe, expect, test } from 'bun:test';
import type { TvmazeMoreDto } from '../../src/client/api/index.ts';
import { akasHtml, castHtml, channelsHtml, crewHtml, episodeBadgesHtml, externalLinksHtml, factsOf, galleryHtml, groupCrew, metaByEpisode, nextPrevHtml } from '../../src/client/catalog/tvmaze-view.ts';

const person = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, name, imageUrl: null, country: null, birthday: null, deathday: null, gender: null, ...over });

const MORE = (over: Partial<TvmazeMoreDto> = {}): TvmazeMoreDto => ({
  type: 'Scripted', language: 'English', genres: ['Drama'], status: 'Running', runtimeMinutes: 60, premiered: '2013-06-24', ended: null,
  scheduleTime: '21:00', scheduleDays: ['Sunday'], weight: 90, updatedAt: null, channels: [], externals: { imdb: null, thetvdb: null, tvrage: null },
  akas: [], cast: [], crew: [], images: [], seasons: [], episodes: [], nextEpisode: null, previousEpisode: null,
  attribution: { name: 'TVmaze', url: 'https://www.tvmaze.com/' }, ...over,
});

describe('tvmaze-view', () => {
  test('escapa nome de pessoa e personagem vindos da API', () => {
    const html = castHtml([{ person: person(1, '<img onerror=x>'), character: { name: '"><script>', imageUrl: null }, voice: false, self: false }]);
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('<script>');
    expect(html).toContain('#/person/tvmaze/1');
  });

  test('elenco vazio não gera seção', () => {
    expect(castHtml([])).toBe('');
    expect(crewHtml([])).toBe('');
    expect(galleryHtml([])).toBe('');
  });

  test('equipe agrupa por função sem repetir a mesma pessoa', () => {
    const groups = groupCrew([
      { role: 'Creator', person: person(1, 'A') },
      { role: 'Creator', person: person(1, 'A') },
      { role: 'Producer', person: person(2, 'B') },
    ]);
    expect(groups).toEqual([
      { role: 'Creator', people: [person(1, 'A')] },
      { role: 'Producer', people: [person(2, 'B')] },
    ]);
  });

  test('ficha técnica omite campos vazios', () => {
    const labels = factsOf(MORE({ type: null, language: null, scheduleDays: [], scheduleTime: null })).map(([k]) => k);
    expect(labels).not.toContain('Tipo');
    expect(labels).not.toContain('Horário');
    expect(labels).toContain('Gêneros');
  });

  test('links externos só para ids presentes', () => {
    expect(externalLinksHtml(MORE())).toBe('');
    expect(externalLinksHtml(MORE({ externals: { imdb: 'tt0944947', thetvdb: 121361, tvrage: null } }))).toContain('imdb.com/title/tt0944947');
  });

  test('onde assistir distingue streaming de TV', () => {
    const html = channelsHtml(MORE({ channels: [{ name: 'HBO', country: 'United States', url: 'https://www.hbo.com/', web: false }, { name: 'Max', country: null, url: null, web: true }] }));
    expect(html).toContain('TV');
    expect(html).toContain('streaming');
  });

  test('série encerrada sem próximo episódio não mostra aviso de agenda', () => {
    expect(nextPrevHtml(MORE({ status: 'Ended' }))).toBe('');
    expect(nextPrevHtml(MORE({ status: 'Running' }))).toContain('sem próximo episódio');
  });

  test('akas e notas por episódio', () => {
    expect(akasHtml(MORE({ akas: [{ name: 'Taht', country: 'Turkey' }] }))).toContain('Taht');
    const meta = metaByEpisode([{ id: 1, season: 2, number: 3, name: 'x', airdate: null, airstamp: null, runtime: 50, rating: 8.64, type: 'regular', url: null, imageUrl: null }]);
    expect(episodeBadgesHtml(meta.get('2:3'))).toContain('★ 8.6');
    expect(episodeBadgesHtml(meta.get('9:9'))).toBe('');
  });
});
