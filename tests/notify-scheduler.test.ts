import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { startNotifyScheduler } from '../src/server/notify/scheduler.ts';
import type { NotifySink } from '../src/server/notify/sinks.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

let db: Database;

beforeEach(() => {
  db = openDb(':memory:');
  const title = upsertTitle(db, { source: 'tvmaze', sourceId: '1', mediaType: 'tv', title: 'Série' });
  upsertLibraryEntry(db, title.id, { watchStatus: 'watching' });
  const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, season.id, [{ episodeNumber: 1, name: 'Ep 1', airDate: '2026-10-22' }]);
});

const countingSink = (): { sink: NotifySink; calls: () => number } => {
  let count = 0;
  return {
    sink: {
      name: 'webhook',
      send: async () => {
        count += 1;
      },
    },
    calls: () => count,
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startNotifyScheduler', () => {
  test('roda já no boot e para de rodar depois de stop()', async () => {
    const counter = countingSink();
    const scheduler = startNotifyScheduler(
      { db, sinks: [counter.sink], leadDays: 0, now: () => new Date(2026, 9, 22, 10), log: () => {} },
      10,
    );
    await wait(5);
    expect(counter.calls()).toBeGreaterThanOrEqual(1);

    scheduler.stop();
    const frozen = counter.calls();
    await wait(40);
    expect(counter.calls()).toBe(frozen);
  });

  test('stop() é idempotente', () => {
    const scheduler = startNotifyScheduler({ db, sinks: [], leadDays: 0, now: () => new Date(), log: () => {} }, 1000);
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });

  test('um ciclo que lança não derruba o agendador: loga e segue', async () => {
    const lines: string[] = [];
    let calls = 0;
    const scheduler = startNotifyScheduler(
      {
        db,
        sinks: [countingSink().sink],
        leadDays: 0,
        now: () => {
          calls += 1;
          throw new RangeError('relógio quebrado');
        },
        log: (line) => lines.push(line),
      },
      5,
    );
    await wait(30);
    scheduler.stop();

    expect(calls).toBeGreaterThan(1);
    expect(lines.some((line) => line.includes('RangeError'))).toBe(true);
  });
});
