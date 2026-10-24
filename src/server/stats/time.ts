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

/** Dia civil (`YYYY-MM-DD`) de um instante, no fuso dado. */
export const localDate = (at: Date | string, tz: string): string => {
  const parts = formatterFor(tz).formatToParts(typeof at === 'string' ? new Date(at) : at);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
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
