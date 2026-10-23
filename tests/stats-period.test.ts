import { describe, expect, test } from 'bun:test';
import { buildPeriod, type HistoryEvent, type ScopeTitle } from '../src/server/stats/period.ts';
import { UNKNOWN_DURATION } from '../src/server/stats/measures.ts';

/** Histórico sintético: nenhum título ou nota real, só o formato dos dados. */
const title = (over: Partial<ScopeTitle> & { minutes?: number | null; without?: number }): ScopeTitle => ({
  genres: over.genres ?? null,
  rating: over.rating ?? null,
  duration: { minutes: over.minutes ?? null, episodesWithoutRuntime: over.without ?? 0 },
});

const ev = (titleId: string, kind: HistoryEvent['kind'], at: string): HistoryEvent => ({ titleId, kind, at });

const SP = 'America/Sao_Paulo';

describe('buildPeriod: agregados de um ano com histórico sintético', () => {
  const titles = new Map<string, ScopeTitle>([
    ['filme', title({ genres: ['Drama', 'Ficção científica'], rating: 8, minutes: 120 })],
    ['serie', title({ genres: ['Comédia'], rating: 6, minutes: 300 })],
    ['sem-duracao', title({ genres: null, minutes: null })],
    ['parcial', title({ genres: [], rating: 9, minutes: 40, without: 2 })],
  ]);
  const events: HistoryEvent[] = [
    ev('filme', 'finished', '2026-02-10T15:00:00Z'),
    ev('filme', 'rewatch_started', '2026-06-01T12:00:00Z'),
    ev('serie', 'finished', '2026-03-01T12:00:00Z'),
    ev('sem-duracao', 'finished', '2026-03-02T12:00:00Z'),
    ev('parcial', 'finished', '2026-03-03T12:00:00Z'),
    ev('serie', 'progress', '2026-03-04T12:00:00Z'),
    ev('serie', 'progress', '2026-03-05T12:00:00Z'),
    ev('serie', 'started', '2026-01-01T12:00:00Z'),
    ev('filme', 'finished', '2025-12-31T12:00:00Z'), // fora do ano
  ];
  const period = buildPeriod({ year: 2026, timeZone: SP, events, titles });

  test('conta conclusões, revisões e marcações de progresso separadamente', () => {
    expect(period.finished).toBe(4);
    expect(period.rewatches).toBe(1);
    expect(period.progressEvents).toBe(2);
  });

  test('tempo assistido soma só exibições com duração; exibição sem duração vai para "faltando"', () => {
    // 120 (filme) + 120 (revisão) + 300 (série) + 40 (parcial, os 2 episódios sem duração ficam de fora)
    expect(period.watchTime).toEqual({ hours: 9.7, knownViewings: 4, missingViewings: 1 });
  });

  test('"progress" é atividade e não soma minutos; "started" não é exibição', () => {
    const march = period.months[2];
    expect(march).toMatchObject({ month: 3, finished: 3, rewatches: 0, progress: 2 });
    expect(march?.hours).toBe(5.7); // 300 + 40, sem o título sem duração
    expect(period.months[0]).toMatchObject({ finished: 0, hours: null });
  });

  test('um mês por posição (1 = janeiro), com horas nulas quando nada tinha duração', () => {
    expect(period.months).toHaveLength(12);
    expect(period.months[1]).toMatchObject({ month: 2, finished: 1, hours: 2 });
    expect(period.months[5]).toMatchObject({ month: 6, rewatches: 1, hours: 2 });
    expect(period.months[11]).toMatchObject({ month: 12, finished: 0, hours: null });
  });

  test('gêneros e notas contam cada título uma vez; sem gênero e lista vazia são "sem gênero"', () => {
    expect(period.genres.top.map((g) => g.name)).toEqual(['Comédia', 'Drama', 'Ficção científica']);
    expect(period.genres.untagged).toBe(2);
    expect(period.ratings).toEqual({ counts: expect.any(Array), average: 7.7, rated: 3, unrated: 1 });
    expect(period.ratings.counts[9]).toBe(1);
  });

  test('dias ativos, dia mais movimentado e maior sequência', () => {
    expect(period.activeDays).toBe(8);
    expect(period.busiestWeekday).toBe(1); // segunda: 2 de março e 1º de junho (empate com terça: vence a primeira)
    expect(period.longestStreak).toEqual({ days: 5, start: '2026-03-01', end: '2026-03-05' });
  });
});

describe('buildPeriod: fronteiras de ano e de horário de verão', () => {
  const titles = new Map<string, ScopeTitle>([['x', title({ minutes: 60 })]]);

  test('virada do ano: conta pelo dia civil local, não pelo UTC', () => {
    // 02:30Z de 1º/jan = 23:30 de 31/dez em São Paulo: é de 2026.
    const events = [ev('x', 'finished', '2027-01-01T02:30:00Z'), ev('x', 'finished', '2027-01-01T03:30:00Z')];
    expect(buildPeriod({ year: 2026, timeZone: SP, events, titles }).finished).toBe(1);
    expect(buildPeriod({ year: 2027, timeZone: SP, events, titles }).finished).toBe(1);
  });

  test('fuso +14: 10:00Z de 31/dez já é 1º/jan do próximo ano', () => {
    const events = [ev('x', 'finished', '2026-12-31T10:00:00Z')];
    expect(buildPeriod({ year: 2026, timeZone: 'Pacific/Kiritimati', events, titles }).finished).toBe(0);
    expect(buildPeriod({ year: 2027, timeZone: 'Pacific/Kiritimati', events, titles }).finished).toBe(1);
  });

  test('horário de verão: o outono move o evento de 1º/nov (UTC) para outubro no fuso de Nova York', () => {
    const events = [ev('x', 'finished', '2026-11-01T03:30:00Z'), ev('x', 'finished', '2026-11-01T06:30:00Z')];
    const p = buildPeriod({ year: 2026, timeZone: 'America/New_York', events, titles });
    expect(p.months[9]?.finished).toBe(1);
    expect(p.months[10]?.finished).toBe(1);
  });
});

describe('buildPeriod: estado vazio', () => {
  test('sem nenhum evento: zeros, sem média, sem sequência, sem dia mais movimentado', () => {
    const p = buildPeriod({ year: 2026, timeZone: 'UTC', events: [], titles: new Map() });
    expect(p).toMatchObject({
      finished: 0,
      rewatches: 0,
      progressEvents: 0,
      activeDays: 0,
      busiestWeekday: null,
      longestStreak: null,
      weekdays: [0, 0, 0, 0, 0, 0, 0],
    });
    expect(p.ratings.average).toBeNull();
    expect(p.months.every((m) => m.hours === null)).toBe(true);
  });

  test('título do histórico que não existe mais na biblioteca conta como "sem duração", sem quebrar', () => {
    const p = buildPeriod({
      year: 2026,
      timeZone: 'UTC',
      events: [ev('removido', 'finished', '2026-04-01T10:00:00Z')],
      titles: new Map(),
    });
    expect(p.finished).toBe(1);
    expect(p.watchTime).toEqual({ hours: 0, knownViewings: 0, missingViewings: 1 });
    expect(UNKNOWN_DURATION.minutes).toBeNull();
  });
});
