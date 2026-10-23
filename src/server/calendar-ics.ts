import type { CalendarEntry } from './repo/calendar.ts';

/** Gerador de iCalendar (RFC 5545) puro: entradas in, texto out, sem I/O nem relógio oculto. */

const CRLF = '\r\n';
const MAX_OCTETS = 75;
const PRODID = '-//nerd-watch//Agenda//PT';
const CAL_NAME = 'nerd-watch Agenda';
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface IcsOptions {
  /** Instante de geração, usado em DTSTAMP. Injetado para o resultado ser determinístico nos testes. */
  now: Date;
}

const utf8Length = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
};

/** Escapa um valor TEXT (RFC 5545 §3.3.11): `\`, `;`, `,` e quebras viram `\\`, `\;`, `\,` e `\n`. Controles sem uso saem. */
export const escapeIcsText = (value: string): string => {
  let out = '';
  for (const ch of value.replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n') out += '\\n';
    else if (ch === '\\' || ch === ';' || ch === ',') out += `\\${ch}`;
    else if (code < 0x20 || code === 0x7f) continue;
    else out += ch;
  }
  return out;
};

/** Dobra a linha em no máximo 75 octetos UTF-8 por linha física; continuações começam com espaço (RFC 5545 §3.1). Nunca parte um caractere. */
export const foldIcsLine = (line: string): string => {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const width = utf8Length(ch);
    if (size + width > limit) {
      parts.push(current);
      current = '';
      size = 0;
      // A continuação ocupa um octeto com o espaço inicial, então sobram 74 para o conteúdo.
      limit = MAX_OCTETS - 1;
    }
    current += ch;
    size += width;
  }
  parts.push(current);
  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join(CRLF);
};

/** Data `AAAA-MM-DD` que existe de fato (rejeita 2026-02-30 e formatos com hora). */
const parseDay = (iso: string): Date | null => {
  const match = DATE_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Formato de DATE do iCalendar: `AAAAMMDD`. */
const icsDate = (date: Date): string =>
  `${String(date.getUTCFullYear()).padStart(4, '0')}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;

/** Formato de DATE-TIME UTC: `AAAAMMDDTHHMMSSZ`. */
const icsStamp = (now: Date): string => `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;

/** UID estável por título, episódio e data: reassinar o feed não duplica eventos. Partes codificadas com `encodeURIComponent` (`|` é codificado, então o separador não colide). */
const uidOf = (entry: CalendarEntry, day: string): string => {
  const ref = entry.kind === 'episode' ? `S${entry.seasonNumber}E${entry.episodeNumber}` : 'movie';
  const parts = [entry.kind, entry.titleSource, entry.titleSourceId, ref, day];
  return `${parts.map((p) => encodeURIComponent(String(p))).join('|')}@nerd-watch`;
};

const eventLines = (entry: CalendarEntry, stamp: string): string[] => {
  const start = parseDay(entry.date);
  if (!start) return [];
  const end = new Date(start.getTime() + DAY_MS);
  const summary = entry.kind === 'episode' ? `${entry.titleName} · T${entry.seasonNumber} Ep ${entry.episodeNumber}` : `${entry.titleName} (estreia)`;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uidOf(entry, entry.date)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(start)}`,
    `DTEND;VALUE=DATE:${icsDate(end)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
  ];
  if (entry.episodeName) lines.push(`DESCRIPTION:${escapeIcsText(entry.episodeName)}`);
  lines.push('END:VEVENT');
  return lines;
};

/** Monta o VCALENDAR com um evento de dia inteiro por entrada. Entradas com data inválida são descartadas. */
export const buildCalendarIcs = (entries: CalendarEntry[], { now }: IcsOptions): string => {
  const stamp = icsStamp(now);
  const header = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeIcsText(CAL_NAME)}`];
  const events = entries.flatMap((entry) => eventLines(entry, stamp));
  return [...header, ...events, 'END:VCALENDAR'].map(foldIcsLine).join(CRLF) + CRLF;
};
