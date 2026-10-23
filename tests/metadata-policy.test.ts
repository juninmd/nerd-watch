import { describe, expect, test } from 'bun:test';
import { needsRefresh, type RefreshableTitle } from '../src/server/metadata/refresh-policy.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Relógio local, como o app usa para "hoje" (todayIso): 22/out/2026 ao meio-dia.
const NOW = new Date(2026, 9, 22, 12, 0, 0);
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const tv = (overrides: Partial<RefreshableTitle> = {}): RefreshableTitle => ({
  media_type: 'tv',
  release_date: '2020-01-01',
  metadata_status: 'Returning Series',
  metadata_refreshed_at: ago(2 * DAY),
  ...overrides,
});

const movie = (overrides: Partial<RefreshableTitle> = {}): RefreshableTitle => ({
  media_type: 'movie',
  release_date: '2020-01-01',
  metadata_status: 'Released',
  metadata_refreshed_at: ago(400 * DAY),
  ...overrides,
});

describe('needsRefresh: nunca atualizado', () => {
  test('série e filme sem nenhum refresh precisam de um, mesmo que o filme já tenha lançado', () => {
    expect(needsRefresh(tv({ metadata_refreshed_at: null }), NOW)).toBe(true);
    expect(needsRefresh(movie({ metadata_refreshed_at: null }), NOW)).toBe(true);
  });

  test('data gravada que não é um instante válido é tratada como "nunca atualizado"', () => {
    expect(needsRefresh(tv({ metadata_refreshed_at: 'não-é-data' }), NOW)).toBe(true);
  });
});

describe('needsRefresh: série em exibição ou não estreada (24 h)', () => {
  test('ainda dentro das 24 h: não precisa', () => {
    expect(needsRefresh(tv({ metadata_refreshed_at: ago(DAY - 1000) }), NOW)).toBe(false);
  });

  test('exatamente 24 h: precisa (o limite é inclusivo)', () => {
    expect(needsRefresh(tv({ metadata_refreshed_at: ago(DAY) }), NOW)).toBe(true);
  });

  test('"In Production", "Planned" e status desconhecido seguem a mesma regra de 24 h', () => {
    for (const status of ['In Production', 'Planned', null]) {
      expect(needsRefresh(tv({ metadata_status: status, metadata_refreshed_at: ago(DAY) }), NOW)).toBe(true);
      expect(needsRefresh(tv({ metadata_status: status, metadata_refreshed_at: ago(DAY - 1000) }), NOW)).toBe(false);
    }
  });
});

describe('needsRefresh: série encerrada (30 dias)', () => {
  test('encerrada há 29 dias: não precisa, mesmo passando das 24 h', () => {
    expect(needsRefresh(tv({ metadata_status: 'Ended', metadata_refreshed_at: ago(29 * DAY) }), NOW)).toBe(false);
  });

  test('exatamente 30 dias: precisa', () => {
    expect(needsRefresh(tv({ metadata_status: 'Ended', metadata_refreshed_at: ago(30 * DAY) }), NOW)).toBe(true);
  });

  test('cancelada ("Canceled") usa o mesmo intervalo de 30 dias', () => {
    expect(needsRefresh(tv({ metadata_status: 'Canceled', metadata_refreshed_at: ago(29 * DAY) }), NOW)).toBe(false);
    expect(needsRefresh(tv({ metadata_status: 'Canceled', metadata_refreshed_at: ago(30 * DAY) }), NOW)).toBe(true);
  });
});

describe('needsRefresh: filme só até lançar', () => {
  test('ainda não lançado (data futura): segue a regra de 24 h', () => {
    const future = '2026-12-01';
    expect(needsRefresh(movie({ release_date: future, metadata_refreshed_at: ago(DAY - 1000) }), NOW)).toBe(false);
    expect(needsRefresh(movie({ release_date: future, metadata_refreshed_at: ago(DAY) }), NOW)).toBe(true);
  });

  test('sem data de lançamento conhecida: trata como não lançado (24 h)', () => {
    expect(needsRefresh(movie({ release_date: null, metadata_refreshed_at: ago(DAY) }), NOW)).toBe(true);
  });

  test('data vazia (TMDB manda "" para filme sem data) conta como não lançado, não como lançado', () => {
    expect(needsRefresh(movie({ release_date: '', metadata_refreshed_at: ago(DAY) }), NOW)).toBe(true);
  });

  test('lançado ontem: já foi atualizado, não precisa mais de refresh automático', () => {
    expect(needsRefresh(movie({ release_date: '2026-10-21', metadata_refreshed_at: ago(365 * DAY) }), NOW)).toBe(false);
  });

  test('lança hoje (mesmo dia local conta como lançado)', () => {
    expect(needsRefresh(movie({ release_date: '2026-10-22', metadata_refreshed_at: ago(365 * DAY) }), NOW)).toBe(false);
  });
});
