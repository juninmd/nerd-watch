import { describe, expect, test } from 'bun:test';
import { type AgendaEntry, cardHtml, originOf, whereLabel } from '../../src/client/calendar/calendar-card.ts';
import type { CalendarInfoDto } from '../../src/client/api/index.ts';

const entry = (over: Partial<AgendaEntry> = {}): AgendaEntry => ({
  kind: 'episode',
  titleSource: 'tvmaze',
  titleSourceId: '1',
  titleName: 'Show <script>',
  mediaType: 'tv',
  posterUrl: null,
  date: '2026-11-20',
  seasonNumber: 2,
  episodeNumber: 1,
  episodeName: null,
  ...over,
});

const info = (over: Partial<CalendarInfoDto> = {}): CalendarInfoDto => ({
  origin: 'serie',
  where: 'stream',
  providers: [{ name: 'Netflix', url: 'https://www.netflix.com/' }],
  pageUrl: 'https://example.com/p',
  officialUrl: null,
  trailerKey: null,
  trailerSearchUrl: 'https://www.youtube.com/results?search_query=x',
  synopsis: 'Sinopse <img src=x onerror=alert(1)>',
  rating: 8.04,
  genres: ['Drama'],
  backdropUrl: null,
  ...over,
});

describe('agenda: cartão', () => {
  test('origem sem ficha vem da fonte e do tipo', () => {
    expect(originOf(entry({ titleSource: 'anilist' }))).toBe('anime');
    expect(originOf(entry({ mediaType: 'movie', titleSource: 'tmdb' }))).toBe('filme');
    expect(originOf(entry())).toBe('serie');
  });

  test('rótulo de onde assistir', () => {
    expect(whereLabel(null)).toBe('');
    expect(whereLabel(info())).toBe('Streaming · Netflix');
    expect(whereLabel(info({ where: 'cinema', providers: [] }))).toBe('Nos cinemas');
  });

  test('dado externo é escapado (título, sinopse) e links abrem com rel seguro', () => {
    const html = cardHtml(entry(), info());
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('★ 8.0');
  });

  test('sem ficha o cartão pede carregamento sob demanda', () => {
    expect(cardHtml(entry(), null)).toContain('data-needs-info');
    expect(cardHtml(entry(), info())).not.toContain('data-needs-info');
  });

  test('o cartão não vira role="button" (há links e botões dentro); o teclado entra pelo botão do título', () => {
    const html = cardHtml(entry(), info());
    expect(html).not.toContain('role="button"');
    expect(html).toContain('<h3 class="cal-title"><button class="cal-title-btn" type="button" data-act="detail"');
  });
});
