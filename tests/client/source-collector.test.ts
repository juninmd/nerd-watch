import { describe, expect, test } from 'bun:test';
import type { TitleStreamsDto } from '../../src/client/api/stremio.ts';
import { addAnswer, allAnswered, hasPlayable, readyToStart, startCollect } from '../../src/client/player/source-collector.ts';

type S = TitleStreamsDto['addons'][number]['streams'][number];
const s = (index: number, kind: S['kind'], description: string): S =>
  ({ index, kind, title: description, description, url: 'https://cdn.example.test/v.mp4', infoHash: null, fileIdx: null, filename: null }) as S;
const answer = (addonId: string, streams: S[], error: string | null = null): TitleStreamsDto =>
  ({ imdbId: 'tt1', addons: [{ addonId, name: addonId, host: 'h', type: 'series', contentId: 'tt1:1:1', error, streams }] }) as TitleStreamsDto;

const ADDONS = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];

describe('tela de carregamento que junta as fontes', () => {
  test('cada resposta entra na ordem dos addons, com contagem e melhor resolução', () => {
    let c = startCollect(ADDONS);
    c = addAnswer(c, 'c', answer('c', [s(0, 'url', 'Ep 720p')]));
    c = addAnswer(c, 'a', answer('a', [s(0, 'url', 'Ep 1080p'), s(1, 'external', 'site')]));
    expect(c.dto.addons.map((g) => g.addonId)).toEqual(['a', 'c']);
    expect(c.addons.find((x) => x.addonId === 'a')).toMatchObject({ status: 'done', count: 1, bestHeight: 1080 });
    expect(c.addons.find((x) => x.addonId === 'b')?.status).toBe('pending');
    expect(allAnswered(c)).toBe(false);
    expect(hasPlayable(c)).toBe(true);
  });

  test('falha de rede e erro do addon contam como respondido (não travam a espera)', () => {
    let c = startCollect(ADDONS.slice(0, 2));
    c = addAnswer(c, 'a', null);
    c = addAnswer(c, 'b', answer('b', [], 'addon fora do ar'));
    expect(c.addons.map((x) => x.status)).toEqual(['error', 'error']);
    expect(allAnswered(c)).toBe(true);
    expect(hasPlayable(c)).toBe(false);
  });

  test('começa antes de todos quando chega a fonte de sempre; sem preferência espera todos', () => {
    let c = startCollect(ADDONS);
    c = addAnswer(c, 'b', answer('b', [s(0, 'url', 'Ep 720p')]));
    expect(readyToStart(c, { addonId: 'b', height: 1080 })).toBe(false);
    c = addAnswer(c, 'a', answer('a', [s(0, 'url', 'Ep 1080p')]));
    expect(readyToStart(c, { addonId: 'a', height: 1080 })).toBe(true);
    expect(readyToStart(c, null)).toBe(false);
    c = addAnswer(c, 'c', answer('c', []));
    expect(readyToStart(c, null)).toBe(true);
  });
});

describe('fonte lembrada por série', () => {
  test('poda mantém as séries tocadas mais recentemente', async () => {
    const { prunePrefs } = await import('../../src/client/player/episode-play-pref.ts');
    const map = { a: { addonId: 'x', height: 1, at: 1 }, b: { addonId: 'x', height: 1, at: 3 }, c: { addonId: 'x', height: 1, at: 2 } };
    expect(Object.keys(prunePrefs(map, 2)).sort()).toEqual(['b', 'c']);
    expect(prunePrefs(map, 5)).toBe(map);
  });
});
