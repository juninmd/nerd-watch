import { describe, expect, test } from 'bun:test';
import { pickSubtitleUrl } from '../src/server/providers/archive.ts';

describe('pickSubtitleUrl', () => {
  test('encontra .srt pelo format "SubRip"', () => {
    const url = pickSubtitleUrl('house_on_haunted_hill_ipod', [
      { name: 'house_on_haunted_hill.mp4', format: 'MPEG4' },
      { name: 'house_on_haunted_hill.asr.srt', format: 'SubRip' },
    ]);
    expect(url).toBe('https://archive.org/download/house_on_haunted_hill_ipod/house_on_haunted_hill.asr.srt');
  });

  test('encontra .vtt pela extensão quando o format não ajuda', () => {
    const url = pickSubtitleUrl('some_item', [{ name: 'legenda.vtt', format: 'Text' }]);
    expect(url).toBe('https://archive.org/download/some_item/legenda.vtt');
  });

  test('retorna null quando não há legenda entre os arquivos', () => {
    const url = pickSubtitleUrl('no_subs_item', [{ name: 'movie.mp4', format: 'MPEG4' }]);
    expect(url).toBeNull();
  });

  test('retorna null quando a lista de arquivos não veio', () => {
    expect(pickSubtitleUrl('missing_files', undefined)).toBeNull();
  });
});
