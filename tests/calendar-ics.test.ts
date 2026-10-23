import { describe, expect, test } from 'bun:test';
import { buildCalendarIcs, escapeIcsText, foldIcsLine } from '../src/server/calendar-ics.ts';
import type { CalendarEntry } from '../src/server/repo/calendar.ts';

const NOW = new Date('2026-01-01T12:00:00Z');
const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Desfaz a dobra de linha (RFC 5545 §3.1): CRLF seguido de espaço continua a linha anterior. */
const unfold = (ics: string): string[] => ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter((l) => l.length > 0);

const episode = (overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  kind: 'episode',
  titleId: '1',
  titleSource: 'tmdb',
  titleSourceId: '1396',
  titleName: 'Breaking Bad',
  mediaType: 'tv',
  posterPath: null,
  date: '2026-11-05',
  seasonNumber: 1,
  episodeNumber: 2,
  episodeName: 'Cat\'s in the Bag...',
  ...overrides,
});

const movie = (overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
  kind: 'movie',
  titleId: '9',
  titleSource: 'tmdb',
  titleSourceId: '603',
  titleName: 'Matrix',
  mediaType: 'movie',
  posterPath: null,
  date: '2026-12-20',
  seasonNumber: null,
  episodeNumber: null,
  episodeName: null,
  ...overrides,
});

const build = (entries: CalendarEntry[], now: Date = NOW): string => buildCalendarIcs(entries, { now });
const uidOf = (ics: string): string | undefined => unfold(ics).find((l) => l.startsWith('UID:'))?.slice(4);

describe('escapeIcsText', () => {
  test('escapa vírgula, ponto e vírgula e barra invertida (RFC 5545 §3.3.11)', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
  });

  test('troca quebras de linha (LF, CRLF, CR) por \\n literal', () => {
    expect(escapeIcsText('linha1\nlinha2')).toBe('linha1\\nlinha2');
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb');
    expect(escapeIcsText('a\rb')).toBe('a\\nb');
  });

  test('a barra escapada não é escapada de novo (ordem de substituição)', () => {
    expect(escapeIcsText(',')).toBe('\\,');
  });

  test('texto vazio e unicode passam sem alteração', () => {
    expect(escapeIcsText('')).toBe('');
    expect(escapeIcsText('Ação & Coração 🎬')).toBe('Ação & Coração 🎬');
  });
});

describe('foldIcsLine', () => {
  test('linha curta (até 75 octetos) sai intacta, sem CRLF', () => {
    expect(foldIcsLine('SUMMARY:curta')).toBe('SUMMARY:curta');
    const exact = 'x'.repeat(75);
    expect(foldIcsLine(exact)).toBe(exact);
  });

  test('linha longa quebra em 75 octetos e continua com espaço (máx. 75 por linha física)', () => {
    const line = `SUMMARY:${'abcdefghij'.repeat(10)}`;
    const physical = foldIcsLine(line).split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    expect(bytes(physical[0] ?? '')).toBe(75);
    for (const part of physical.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(bytes(part)).toBeLessThanOrEqual(75);
    }
    expect(physical.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  test('caracteres multibyte (acentos) nunca são partidos no meio', () => {
    const line = `SUMMARY:${'ação '.repeat(40)}`;
    const physical = foldIcsLine(line).split('\r\n');
    for (const part of physical) expect(bytes(part)).toBeLessThanOrEqual(75);
    expect(physical.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  test('emoji de 4 octetos não é partido e a linha respeita o limite', () => {
    const line = `SUMMARY:${'🎬'.repeat(30)}`;
    const physical = foldIcsLine(line).split('\r\n');
    for (const part of physical) expect(bytes(part)).toBeLessThanOrEqual(75);
    expect(physical.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
});

describe('buildCalendarIcs', () => {
  test('calendário vazio ainda é um VCALENDAR válido, sem VEVENT', () => {
    const ics = build([]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0\r\n');
    expect(ics).toContain('PRODID:');
    expect(ics).toContain('X-WR-CALNAME:');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  test('todas as quebras de linha são CRLF (nenhum LF solto)', () => {
    const ics = build([episode(), movie()]);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ics).not.toContain('\r\r');
  });

  test('episódio vira evento de dia inteiro com DTEND exclusivo no dia seguinte', () => {
    const lines = unfold(build([episode()]));
    expect(lines).toContain('DTSTART;VALUE=DATE:20261105');
    expect(lines).toContain('DTEND;VALUE=DATE:20261106');
    expect(lines).toContain('DTSTAMP:20260101T120000Z');
  });

  test('SUMMARY identifica temporada e episódio e escapa vírgulas do título', () => {
    const entry = episode({ titleName: 'Lost, Brasil', seasonNumber: 1, episodeNumber: 3 });
    const summary = unfold(build([entry])).find((l) => l.startsWith('SUMMARY:'));
    expect(summary).toBe('SUMMARY:Lost\\, Brasil · T1 Ep 3');
  });

  test('estreia de filme usa a data de lançamento e marca como estreia', () => {
    const lines = unfold(build([movie()]));
    expect(lines).toContain('DTSTART;VALUE=DATE:20261220');
    expect(lines).toContain('DTEND;VALUE=DATE:20261221');
    expect(lines.find((l) => l.startsWith('SUMMARY:'))).toBe('SUMMARY:Matrix (estreia)');
  });

  test('nome de episódio com quebra de linha não injeta linhas no arquivo', () => {
    const ics = build([episode({ episodeName: 'linha um\nBEGIN:VEVENT' })]);
    const lines = unfold(ics);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.find((l) => l.startsWith('DESCRIPTION:'))).toContain('linha um\\nBEGIN:VEVENT');
  });

  test('UID é estável: mesmo episódio em outro instante gera o mesmo UID, com DTSTAMP novo', () => {
    const later = new Date('2027-06-01T08:30:00Z');
    const first = build([episode()]);
    const second = build([episode()], later);
    expect(uidOf(first)).toBeDefined();
    expect(uidOf(first)).toBe(uidOf(second));
    expect(unfold(second)).toContain('DTSTAMP:20270601T083000Z');
  });

  test('UID distingue episódios e datas diferentes do mesmo título', () => {
    const ep1 = uidOf(build([episode({ episodeNumber: 1 })]));
    const ep2 = uidOf(build([episode({ episodeNumber: 2 })]));
    const otherDate = uidOf(build([episode({ date: '2026-11-12' })]));
    expect(new Set([ep1, ep2, otherDate]).size).toBe(3);
  });

  test('UID de títulos com fontes diferentes e ids com caracteres especiais não colide', () => {
    const tmdb = uidOf(build([episode({ titleSource: 'tmdb', titleSourceId: 'a b' })]));
    const tvmaze = uidOf(build([episode({ titleSource: 'tvmaze', titleSourceId: 'a b' })]));
    const slashed = uidOf(build([episode({ titleSource: 'telegram', titleSourceId: 'c/123' })]));
    expect(tmdb).not.toBe(tvmaze);
    expect(slashed).not.toContain('/');
    expect(slashed).not.toContain(' ');
  });

  test('datas de borda: ano bissexto e virada de ano', () => {
    const leap = unfold(build([episode({ date: '2028-02-29' })]));
    expect(leap).toContain('DTEND;VALUE=DATE:20280301');
    const newYear = unfold(build([movie({ date: '2026-12-31' })]));
    expect(newYear).toContain('DTEND;VALUE=DATE:20270101');
  });

  test('data inválida ou fora do formato AAAA-MM-DD é descartada, sem derrubar o resto', () => {
    const ics = build([episode({ date: '2026-02-30' }), episode({ date: '2026-11-05T00:00:00' }), movie()]);
    const lines = unfold(ics);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines).toContain('DTSTART;VALUE=DATE:20261220');
  });

  test('linha longa de SUMMARY é dobrada e continua reconstruível', () => {
    const name = 'Título muito longo com acentuação e vírgulas, '.repeat(4);
    const ics = build([movie({ titleName: name })]);
    for (const part of ics.split('\r\n')) expect(bytes(part)).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain(`SUMMARY:${escapeIcsText(name)} (estreia)`);
  });
});
