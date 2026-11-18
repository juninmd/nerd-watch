import { describe, expect, test } from 'bun:test';
import type { CalendarEntryDto, HealthResponse } from '../../src/client/api/index.ts';
import { homeKpis, nextRelease, releaseIn, sourceRows } from '../../src/client/home/home-status.ts';

const entry = (date: string, titleName = 'Neon Atlas'): CalendarEntryDto => ({
  kind: 'episode', titleId: 't', titleSource: 'tmdb', titleSourceId: '1', titleName, mediaType: 'tv',
  posterUrl: null, date, seasonNumber: 1, episodeNumber: 2, episodeName: null,
});

describe('releaseIn', () => {
  test('hoje, amanhã, em N dias e passado', () => {
    expect(releaseIn('2026-11-18', '2026-11-18')).toBe('hoje');
    expect(releaseIn('2026-11-19', '2026-11-18')).toBe('amanhã');
    expect(releaseIn('2026-12-01', '2026-11-18')).toBe('em 13 dias');
    expect(releaseIn('2026-11-17', '2026-11-18')).toBeNull();
  });
  test('vira o mês sem erro de fuso', () => {
    expect(releaseIn('2026-03-01', '2026-02-28')).toBe('amanhã');
  });
});

describe('homeKpis', () => {
  test('pega o lançamento mais próximo e ignora os passados', () => {
    const k = homeKpis({ watching: 3, queued: 1, entries: [entry('2026-11-10'), entry('2026-11-25', 'B'), entry('2026-11-19', 'A')], todayIso: '2026-11-18' });
    expect(k.map((x) => x.value)).toEqual(['3', '1', 'amanhã']);
    expect(k[2]?.hint).toBe('A');
    expect(k[1]?.label).toBe('episódio na fila');
  });
  test('sem agenda, não inventa o terceiro número', () => {
    expect(homeKpis({ watching: 0, queued: 5, entries: [], todayIso: '2026-11-18' })).toHaveLength(2);
    expect(nextRelease([], '2026-11-18')).toBeNull();
  });
});

describe('sourceRows', () => {
  test('diz o que falta ligar', () => {
    const h: HealthResponse = { ok: true, tmdbEnabled: true, openSubtitlesEnabled: false, torrentEnabled: true, telegramBotEnabled: false, notifyEnabled: true, notifyLeadDays: 1, accessEnabled: false };
    const rows = sourceRows(h);
    expect(rows.filter((r) => !r.ok).map((r) => r.label)).toEqual(['Legendas', 'Telegram']);
    expect(rows.find((r) => r.label === 'TMDB')?.detail).toBe('catálogo ligado');
  });
});

describe('contagem na agenda', () => {
  test('cartão da agenda mostra "hoje" na data de hoje', async () => {
    const { cardHtml } = await import('../../src/client/calendar/calendar-card.ts');
    const { localIsoDate } = await import('../../src/client/ui/time-format.ts');
    const { titleId: _t, ...e } = entry(localIsoDate(new Date()));
    expect(cardHtml(e, null)).toContain('<span class="cal-countdown">hoje</span>');
    expect(cardHtml({ ...e, date: '2000-01-01' }, null)).not.toContain('cal-countdown');
  });
});
