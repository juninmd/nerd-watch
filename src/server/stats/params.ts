import { isValidTimeZone, localDate, yearOfDate } from './time.ts';

export const HOURS_PER_DAY_DEFAULT = 1;
export const HOURS_PER_DAY_MIN = 0.25;
export const HOURS_PER_DAY_MAX = 12;
const YEAR_MIN = 1970;
const YEAR_MAX = 2100;

export interface StatsParams {
  year: number;
  timeZone: string;
  hoursPerDay: number;
}

export interface StatsParamsError {
  error: string;
}

export interface RawStatsQuery {
  year?: string;
  tz?: string;
  hpd?: string;
}

const DIGITS_4 = /^\d{4}$/;
const DECIMAL = /^\d{1,2}(\.\d{1,2})?$/;

/**
 * Valida a query de `/api/stats`. Sem `year` vale o ano civil atual no fuso; sem `tz`, UTC; sem `hpd`, 1 h/dia.
 * Qualquer valor fora da faixa vira erro 400 (nada é silenciosamente corrigido).
 */
export const parseStatsParams = (raw: RawStatsQuery, now: Date): StatsParams | StatsParamsError => {
  const timeZone = raw.tz ?? 'UTC';
  if (timeZone.length > 64 || !isValidTimeZone(timeZone))
    return { error: 'tz deve ser um fuso IANA válido (ex.: America/Sao_Paulo)' };

  let year = yearOfDate(localDate(now, timeZone));
  if (raw.year !== undefined) {
    if (!DIGITS_4.test(raw.year)) return { error: 'year deve ter 4 dígitos' };
    year = Number(raw.year);
    if (year < YEAR_MIN || year > YEAR_MAX) return { error: `year deve estar entre ${YEAR_MIN} e ${YEAR_MAX}` };
  }

  let hoursPerDay = HOURS_PER_DAY_DEFAULT;
  if (raw.hpd !== undefined) {
    const value = DECIMAL.test(raw.hpd) ? Number(raw.hpd) : Number.NaN;
    if (!(value >= HOURS_PER_DAY_MIN && value <= HOURS_PER_DAY_MAX)) {
      return { error: `hpd deve ser de ${HOURS_PER_DAY_MIN} a ${HOURS_PER_DAY_MAX} horas por dia` };
    }
    hoursPerDay = value;
  }

  return { year, timeZone, hoursPerDay };
};

export const isStatsError = (v: StatsParams | StatsParamsError): v is StatsParamsError => 'error' in v;
