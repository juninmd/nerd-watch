import { describe, expect, test } from 'bun:test';
import type { TvmazeMoreDto } from '../../src/client/api/index.ts';
import { channelKind, episodeTypeTag, externalLinks, factsOf, groupCrew, metaByEpisode, seasonSummaryText, showAgenda } from '../../src/client/catalog/tvmaze-view.ts';

const person = (id: number, name: string, over: Record<string, unknown> = {}) => ({ id, name, imageUrl: null, country: null, birthday: null, deathday: null, gender: null, ...over });

const MORE = (over: Partial<TvmazeMoreDto> = {}): TvmazeMoreDto => ({
  type: 'Scripted', language: 'English', genres: ['Drama'], status: 'Running', runtimeMinutes: 60, premiered: '2013-06-24', ended: null,
  scheduleTime: '21:00', scheduleDays: ['Sunday'], weight: 90, updatedAt: null, channels: [], externals: { imdb: null, thetvdb: null, tvrage: null },
  akas: [], cast: [], crew: [], images: [], seasons: [], episodes: [], nextEpisode: null, previousEpisode: null,
  attribution: { name: 'TVmaze', url: 'https://www.tvmaze.com/' }, ...over,
});

describe('tvmaze-view', () => {
  test('equipe vazia não gera grupos', () => {
    expect(groupCrew([])).toEqual([]);
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
    expect(externalLinks(MORE())).toEqual([]);
    const links = externalLinks(MORE({ externals: { imdb: 'tt0944947', thetvdb: 121361, tvrage: null } }));
    expect(links.map(([n]) => n)).toEqual(['IMDb', 'TheTVDB']);
    expect(links[0]?.[1]).toContain('imdb.com/title/tt0944947');
  });

  test('onde assistir distingue streaming de TV', () => {
    expect(channelKind({ web: false })).toBe('TV');
    expect(channelKind({ web: true })).toBe('streaming');
  });

  test('série encerrada sem próximo episódio não mostra aviso de agenda', () => {
    expect(showAgenda(MORE({ status: 'Ended' }))).toBe(false);
    expect(showAgenda(MORE({ status: 'Running' }))).toBe(true);
  });

  test('notas por episódio', () => {
    const meta = metaByEpisode([{ id: 1, season: 2, number: 3, name: 'x', airdate: null, airstamp: null, runtime: 50, rating: 8.64, type: 'regular', url: null, imageUrl: null }]);
    expect(meta.get('2:3')?.rating).toBe(8.64);
    expect(meta.get('9:9')).toBeUndefined();
  });

  test('tipo de episódio vira selo só quando não é comum', () => {
    expect(episodeTypeTag({ type: 'regular' })).toBeNull();
    expect(episodeTypeTag(undefined)).toBeNull();
    expect(episodeTypeTag({ type: 'significant_special' })).toBe('especial');
    expect(episodeTypeTag({ type: 'insignificant_special' })).toBe('extra');
  });

  test('linha da temporada junta só o que a TVmaze preencheu', () => {
    const seasons = [{ number: 1, name: null, episodeOrder: 25, premiereDate: '1998-09-21', endDate: null, imageUrl: null, summary: null, channel: 'CBS' }];
    const text = seasonSummaryText({ seasons }, 1);
    expect(text).toContain('25 episódios encomendados');
    expect(text).toContain('CBS');
    expect(text).not.toContain('final');
    expect(seasonSummaryText({ seasons }, 2)).toBe('');
  });
});
