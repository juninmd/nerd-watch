import { describe, expect, test } from 'bun:test';
import { OpenSubtitlesNotConfiguredError, openSubtitlesEnabled, requestSubtitleDownload, searchSubtitles } from '../src/server/providers/opensubtitles.ts';

describe('opensubtitles sem OPENSUBTITLES_API_KEY (ambiente de teste)', () => {
  test('openSubtitlesEnabled() é false', () => {
    expect(openSubtitlesEnabled()).toBe(false);
  });

  test('searchSubtitles rejeita com OpenSubtitlesNotConfiguredError', async () => {
    await expect(searchSubtitles({ query: 'anything' })).rejects.toBeInstanceOf(OpenSubtitlesNotConfiguredError);
  });

  test('requestSubtitleDownload rejeita com OpenSubtitlesNotConfiguredError', async () => {
    await expect(requestSubtitleDownload(123)).rejects.toBeInstanceOf(OpenSubtitlesNotConfiguredError);
  });
});
