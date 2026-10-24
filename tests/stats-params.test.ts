import { describe, expect, test } from 'bun:test';
import { isStatsError, parseStatsParams } from '../src/server/stats/params.ts';

const NOW = new Date('2027-01-01T01:00:00Z');

describe('parseStatsParams: entrada da API validada, nunca corrigida em silêncio', () => {
  test('sem parâmetros: fuso UTC, ano atual em UTC e 1 h/dia', () => {
    expect(parseStatsParams({}, NOW)).toEqual({ year: 2027, timeZone: 'UTC', hoursPerDay: 1 });
  });

  test('o ano padrão segue o dia civil do fuso: 01:00Z de 1º/jan ainda é 31/dez em São Paulo', () => {
    expect(parseStatsParams({ tz: 'America/Sao_Paulo' }, NOW)).toMatchObject({ year: 2026 });
  });

  test('ano precisa ter exatamente 4 dígitos e estar entre 1970 e 2100', () => {
    expect(parseStatsParams({ year: '2026' }, NOW)).toMatchObject({ year: 2026 });
    for (const bad of ['26', '20x6', '1969', '2101', 'abcd', '2026.0', '']) {
      expect(isStatsError(parseStatsParams({ year: bad }, NOW))).toBe(true);
    }
  });

  test('fuso precisa ser IANA válido e curto', () => {
    expect(isStatsError(parseStatsParams({ tz: 'Mars/Olympus' }, NOW))).toBe(true);
    expect(isStatsError(parseStatsParams({ tz: 'x'.repeat(70) }, NOW))).toBe(true);
    expect(parseStatsParams({ tz: 'Pacific/Kiritimati' }, NOW)).toMatchObject({ timeZone: 'Pacific/Kiritimati' });
  });

  test('horas por dia: decimal de 0,25 a 12; fora disso, erro', () => {
    expect(parseStatsParams({ hpd: '0.25' }, NOW)).toMatchObject({ hoursPerDay: 0.25 });
    expect(parseStatsParams({ hpd: '12' }, NOW)).toMatchObject({ hoursPerDay: 12 });
    for (const bad of ['0', '0.1', '13', '-1', '1e2', 'abc', '1.234']) {
      expect(isStatsError(parseStatsParams({ hpd: bad }, NOW))).toBe(true);
    }
  });
});
