/**
 * Datas das estatísticas. Decisão de fuso: os eventos ficam em UTC (`library_history.at`, ISO) e cada agregado
 * usa o DIA CIVIL no fuso IANA do navegador (`?tz=`), calculado com Intl. Assim DST e a virada do ano seguem o
 * relógio local, sem deslocamento fixo. Depois de convertida, a data é só texto `YYYY-MM-DD`: a aritmética de
 * dias é feita em UTC (sem DST), então "dia seguinte" e "diferença de dias" não dependem do fuso.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** `true` se o Intl do ambiente reconhece o fuso (nome IANA, ex.: `America/Sao_Paulo`). */
export const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const formatterFor = (tz: string): Intl.DateTimeFormat => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
};

const exactLocalDate = (at: Date, tz: string): string => {
  const parts = formatterFor(tz).formatToParts(at);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

/**
 * Atalho do `localDate`: para cada dia UTC guarda o deslocamento do fuso, quando ele é o mesmo no começo e no
 * fim do dia (ou seja, sem virada de horário de verão ali dentro). Aí a data local sai por aritmética, sem
 * `formatToParts` por evento, que era o custo dominante de `/api/stats` com milhares de eventos.
 * Dia com virada fica `null` e cai no caminho exato. Teto de entradas: um fuso por navegador, 366 dias por ano.
 */
const dayOffsets = new Map<string, Map<number, number | null>>();
const MAX_CACHED_DAYS = 4000;
const FAST_PATH_END_MS = Date.UTC(2100, 0, 1);

const dayOffset = (utcDay: number, tz: string): number | null => {
  let byDay = dayOffsets.get(tz);
  if (!byDay) {
    byDay = new Map();
    dayOffsets.set(tz, byDay);
  }
  const hit = byDay.get(utcDay);
  if (hit !== undefined) return hit;
  // Data local à 00:00 e às 23:59:59 UTC, mais as horas de borda: iguais nos dois extremos = dia sem virada.
  const start = utcDay * DAY_MS;
  const offset = wallClockOffset(start, tz);
  const stable = offset === wallClockOffset(start + DAY_MS - 1000, tz) ? offset : null;
  if (byDay.size >= MAX_CACHED_DAYS) byDay.clear();
  byDay.set(utcDay, stable);
  return stable;
};

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** Quanto o relógio de parede do fuso está adiantado (ou atrasado) em relação ao UTC naquele instante, em ms. */
const wallClockOffset = (ms: number, tz: string): number => {
  let f = clockFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    clockFormatters.set(tz, f);
  }
  const part: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) part[p.type] = Number(p.value);
  const wall = Date.UTC(part.year as number, (part.month as number) - 1, part.day, part.hour, part.minute, part.second);
  return wall - Math.floor(ms / 1000) * 1000;
};

/** Dia civil (`YYYY-MM-DD`) de um instante, no fuso dado. */
export const localDate = (at: Date | string, tz: string): string => {
  const date = typeof at === 'string' ? new Date(at) : at;
  const ms = date.getTime();
  // Fora de 1970–2100 (ou data inválida) vai pelo caminho exato: o atalho só cobre o que o histórico de fato guarda.
  if (!(ms >= 0 && ms < FAST_PATH_END_MS)) return exactLocalDate(date, tz);
  const offset = dayOffset(Math.floor(ms / DAY_MS), tz);
  if (offset === null) return exactLocalDate(date, tz);
  return new Date(ms + offset).toISOString().slice(0, 10);
};

/** Número do dia desde a época (UTC, sem DST): base para diferença e soma de dias. */
const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

export const isDate = (v: string): boolean => DATE_RE.test(v);

export const yearOfDate = (date: string): number => Number(date.slice(0, 4));

export const monthOfDate = (date: string): number => Number(date.slice(5, 7));

/** Dia da semana de uma data civil: 0 = domingo … 6 = sábado (igual ao `Date.getDay`). */
export const weekdayOf = (date: string): number => new Date(dayNumber(date) * DAY_MS).getUTCDay();

/** `b - a` em dias civis (negativo se `b` vem antes). */
export const dayDiff = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

export const addDays = (date: string, days: number): string =>
  new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);

export const todayLocal = (now: Date, tz: string): string => localDate(now, tz);

/**
 * Janela UTC que cobre o ano civil inteiro em qualquer fuso (offsets vão de -12 a +14 h): busca com folga e
 * o filtro exato por dia civil acontece depois, em `localDate`. Mantém a consulta limitada a um intervalo.
 */
export const yearWindowUtc = (year: number): { from: string; to: string } => ({
  from: new Date(Date.UTC(year - 1, 11, 30)).toISOString(),
  to: new Date(Date.UTC(year + 1, 0, 3)).toISOString(),
});
