import { describe, expect, test } from 'bun:test';
import { nextPlayable, sourceOptions, sourceTriggerLabel } from '../../src/client/addons/stream-switch.ts';
import type { TitleStreamsDto } from '../../src/client/api/stremio.ts';

type S = TitleStreamsDto['addons'][number]['streams'][number];
const s = (index: number, kind: S['kind'], description: string): S =>
  ({ index, kind, title: description, description, url: 'https://cdn.example.test/v.mp4', infoHash: null, fileIdx: null, filename: null }) as S;
const group = (addonId: string, streams: S[]) => ({ addonId, name: addonId.toUpperCase(), host: 'h', type: 'series', contentId: 'tt1:1:1', error: null, streams });

const DTO = {
  imdbId: 'tt1',
  addons: [group('a', [s(0, 'url', 'Ep 1080p'), s(1, 'external', 'site'), s(2, 'url', 'Ep 720p')]), group('b', [s(0, 'torrent', 'Ep.2160p')])],
} as TitleStreamsDto;

describe('troca de fonte no player', () => {
  test('menu lista só fontes tocáveis, com resolução e addon, marcando a atual', () => {
    const opts = sourceOptions(DTO, { addonId: 'a', index: 2 });
    expect(opts.map((o) => o.label)).toEqual(['1080p · A', '720p · A', '4K · B']);
    expect(opts.filter((o) => o.active).map((o) => o.index)).toEqual([2]);
  });

  test('resolução desconhecida não vira "?": rótulo só com o addon e botão "Fonte"', () => {
    const dto = { imdbId: null, addons: [group('c', [s(0, 'url', 'episódio')])] } as TitleStreamsDto;
    const opts = sourceOptions(dto, { addonId: 'c', index: 0 });
    expect(opts[0]?.label).toBe('C');
    expect(sourceTriggerLabel(opts)).toBe('Fonte');
    expect(sourceTriggerLabel(sourceOptions(DTO, { addonId: 'b', index: 0 }))).toBe('4K');
  });

  test('plano B pula a que falhou e as já tentadas, dando a volta na lista', () => {
    expect(nextPlayable(DTO, { addonId: 'a', index: 0 }, [])).toEqual({ addonId: 'a', index: 2 });
    expect(nextPlayable(DTO, { addonId: 'b', index: 0 }, [])).toEqual({ addonId: 'a', index: 0 });
    expect(nextPlayable(DTO, { addonId: 'a', index: 0 }, [{ addonId: 'a', index: 2 }, { addonId: 'b', index: 0 }])).toBeNull();
  });
});
