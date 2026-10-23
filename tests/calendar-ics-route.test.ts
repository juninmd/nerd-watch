import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb, openDb, resetDbForTests } from '../src/server/db.ts';
import { calendarIcsRoutes } from '../src/server/routes/calendar.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const daysFromNow = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const unfold = (ics: string): string[] => ics.replace(/\r\n[ \t]/g, '').split('\r\n');

describe('GET /api/calendar.ics', () => {
  test('responde text/calendar em UTF-8 com o episódio da biblioteca', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '1', mediaType: 'tv', title: 'Série' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watching' });
    const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
    replaceEpisodes(db, season.id, [{ episodeNumber: 4, name: 'Ep', overview: '', airDate: daysFromNow(3) }]);

    const res = await calendarIcsRoutes.request('/calendar.ics?days=30');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');

    const lines = unfold(await res.text());
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain(`DTSTART;VALUE=DATE:${daysFromNow(3).replaceAll('-', '')}`);
    expect(lines.find((l) => l.startsWith('SUMMARY:'))).toBe('SUMMARY:Série · T1 Ep 4');
  });

  test('sem nada agendado devolve um calendário vazio válido', async () => {
    const res = await calendarIcsRoutes.request('/calendar.ics');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
    expect(body).not.toContain('BEGIN:VEVENT');
  });

  test('UID se mantém entre duas requisições (reassinar não duplica)', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '2', mediaType: 'tv', title: 'Série' });
    upsertLibraryEntry(db, title.id, { watchStatus: 'watching' });
    const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'T1' });
    replaceEpisodes(db, season.id, [{ episodeNumber: 1, name: 'Ep', overview: '', airDate: daysFromNow(2) }]);

    const uidOf = async () => unfold(await (await calendarIcsRoutes.request('/calendar.ics?days=30')).text()).find((l) => l.startsWith('UID:'));
    const first = await uidOf();
    expect(first).toBeDefined();
    expect(await uidOf()).toBe(first);
  });

  test('"days" inválido ou acima de 365 cai no padrão de 60 dias', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '3', mediaType: 'movie', title: 'Filme', releaseDate: daysFromNow(100) });
    upsertLibraryEntry(db, title.id, { watchStatus: 'want' });

    // 100 dias à frente só cabe na janela padrão (60) se o valor inválido for ignorado e não zerar a janela.
    const invalid = await (await calendarIcsRoutes.request('/calendar.ics?days=9999')).text();
    expect(invalid).not.toContain('BEGIN:VEVENT');
    const bogus = await (await calendarIcsRoutes.request('/calendar.ics?days=abc')).text();
    expect(bogus).not.toContain('BEGIN:VEVENT');
  });

  test('"days" dentro do limite (365) é respeitado', async () => {
    const db = await getDb();
    const title = upsertTitle(db, { source: 'tmdb', sourceId: '4', mediaType: 'movie', title: 'Filme', releaseDate: daysFromNow(100) });
    upsertLibraryEntry(db, title.id, { watchStatus: 'want' });

    const body = await (await calendarIcsRoutes.request('/calendar.ics?days=365')).text();
    expect(body).toContain('BEGIN:VEVENT');
  });
});
