import { describe, expect, test } from 'bun:test';
import type { CalendarEntry } from '../src/server/repo/calendar.ts';
import { dueNotifications, notificationKey } from '../src/server/notify/due.ts';

const episode = (date: string, overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  kind: 'episode',
  titleId: 't1',
  titleSource: 'tvmaze',
  titleSourceId: '1',
  titleName: 'Série',
  mediaType: 'tv',
  posterPath: null,
  date,
  seasonNumber: 2,
  episodeNumber: 5,
  episodeName: 'Ep',
  ...overrides,
});

const movie = (date: string): CalendarEntry => ({
  kind: 'movie',
  titleId: 'm1',
  titleSource: 'tmdb',
  titleSourceId: '603',
  titleName: 'Filme',
  mediaType: 'movie',
  posterPath: null,
  date,
  seasonNumber: null,
  episodeNumber: null,
  episodeName: null,
});

/** `now` em hora LOCAL, como o app: o teste não depende do fuso da máquina. */
const localAt = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min);
const NONE = new Set<string>();

describe('dueNotifications: janela de aviso', () => {
  test('lista vazia não gera nada', () => {
    expect(dueNotifications([], localAt(2026, 10, 22), 3, NONE)).toEqual([]);
  });

  test('com lead 0 só avisa no dia do lançamento', () => {
    const now = localAt(2026, 10, 22);
    const due = dueNotifications([episode('2026-10-22'), episode('2026-10-23')], now, 0, NONE);
    expect(due.map((d) => d.entry.date)).toEqual(['2026-10-22']);
    expect(due[0]?.daysUntil).toBe(0);
  });

  test('com lead 7 avisa a partir de 7 dias antes, e não antes', () => {
    const entries = [episode('2026-10-29'), episode('2026-10-30')];
    const due = dueNotifications(entries, localAt(2026, 10, 22), 7, NONE);
    expect(due.map((d) => d.entry.date)).toEqual(['2026-10-29']);
    expect(due[0]?.daysUntil).toBe(7);
  });

  test('lançamento já passado não é avisado (a lista é do futuro)', () => {
    expect(dueNotifications([episode('2026-10-21')], localAt(2026, 10, 22), 7, NONE)).toEqual([]);
  });

  test('a virada do dia no fuso local muda o que é "hoje"', () => {
    const entries = [episode('2026-10-22')];
    // 23:59 do dia 21 ainda é dia 21: o lançamento do dia 22 está a 1 dia, fora do lead 0.
    expect(dueNotifications(entries, localAt(2026, 10, 21, 23, 59), 0, NONE)).toEqual([]);
    // 00:01 do dia 22 já é "hoje": avisa.
    expect(dueNotifications(entries, localAt(2026, 10, 22, 0, 1), 0, NONE)).toHaveLength(1);
  });

  test('filme usa a data de estreia da mesma forma', () => {
    const due = dueNotifications([movie('2026-10-25')], localAt(2026, 10, 22), 3, NONE);
    expect(due).toHaveLength(1);
    expect(due[0]?.entry.kind).toBe('movie');
  });
});

describe('dueNotifications: deduplicação', () => {
  test('o que já foi enviado não volta, mesmo dentro da janela', () => {
    const entry = episode('2026-10-22');
    const sent = new Set([notificationKey(entry)]);
    expect(dueNotifications([entry], localAt(2026, 10, 22), 0, sent)).toEqual([]);
  });

  test('a chave é estável por título/episódio/data: mudar a data gera novo aviso', () => {
    const original = episode('2026-10-22');
    const moved = episode('2026-10-24');
    expect(notificationKey(original)).toBe(notificationKey(episode('2026-10-22')));
    expect(notificationKey(original)).not.toBe(notificationKey(moved));
  });

  test('episódios diferentes do mesmo título têm chaves diferentes', () => {
    expect(notificationKey(episode('2026-10-22', { episodeNumber: 5 }))).not.toBe(
      notificationKey(episode('2026-10-22', { episodeNumber: 6 })),
    );
  });

  test('filme e episódio nunca colidem', () => {
    expect(notificationKey(movie('2026-10-22'))).not.toBe(notificationKey(episode('2026-10-22')));
  });
});
