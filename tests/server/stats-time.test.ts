import { describe, expect, test } from 'bun:test';
import { addDays, dayDiff, isValidTimeZone, localDate, weekdayOf, yearWindowUtc } from '../../src/server/stats/time.ts';

/**
 * Fuso e calendário: o dia civil muda com o fuso e com o horário de verão. Os casos de borda abaixo são os que
 * uma conta com offset fixo erraria (DST, virada de ano em fusos extremos, sem DST em São Paulo).
 */
describe('localDate: dia civil no fuso do navegador', () => {
  test('horário de verão (primavera): 06:30Z ainda é 01:30 EST e 07:30Z já é 03:30 EDT, mesmo dia', () => {
    expect(localDate('2026-03-08T06:30:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(localDate('2026-03-08T07:30:00Z', 'America/New_York')).toBe('2026-03-08');
  });

  test('evento logo antes da meia-noite local cai no dia anterior (não no dia UTC)', () => {
    expect(localDate('2026-03-08T04:30:00Z', 'America/New_York')).toBe('2026-03-07');
  });

  test('fim do horário de verão (outono): 03:30Z de 1º/nov ainda é 31/out no fuso de Nova York', () => {
    expect(localDate('2026-11-01T03:30:00Z', 'America/New_York')).toBe('2026-10-31');
    expect(localDate('2026-11-01T06:30:00Z', 'America/New_York')).toBe('2026-11-01');
  });

  test('virada do ano em São Paulo (UTC-3, sem DST): 02:30Z de 1º/jan é 31/dez do ano anterior', () => {
    expect(localDate('2027-01-01T02:30:00Z', 'America/Sao_Paulo')).toBe('2026-12-31');
    expect(localDate('2027-01-01T03:30:00Z', 'America/Sao_Paulo')).toBe('2027-01-01');
  });

  test('fusos extremos: +14 (Kiritimati) vira o ano antes de UTC; -12 ainda não', () => {
    expect(localDate('2026-12-31T09:59:00Z', 'Pacific/Kiritimati')).toBe('2026-12-31');
    expect(localDate('2026-12-31T10:00:00Z', 'Pacific/Kiritimati')).toBe('2027-01-01');
    expect(localDate('2027-01-01T11:30:00Z', 'Etc/GMT+12')).toBe('2026-12-31');
  });

  test('aceita Date e texto ISO com o mesmo resultado', () => {
    expect(localDate(new Date('2026-03-08T06:30:00Z'), 'America/New_York')).toBe(
      localDate('2026-03-08T06:30:00Z', 'America/New_York'),
    );
  });
});

describe('aritmética de dias civis (sem DST, sem fuso)', () => {
  test('dia da semana: 0 = domingo; 2026-10-22 é quinta; 2024-02-29 (bissexto) é quinta', () => {
    expect(weekdayOf('2026-10-22')).toBe(4);
    expect(weekdayOf('2024-02-29')).toBe(4);
    expect(weekdayOf('2026-03-01')).toBe(0);
  });

  test('somar dias atravessa mês, ano e fevereiro bissexto', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2026-10-22', -22)).toBe('2026-09-30');
  });

  test('diferença de dias não sofre com a mudança de hora (dia de DST tem 23 h, conta como 1 dia)', () => {
    expect(dayDiff('2026-03-07', '2026-03-08')).toBe(1);
    expect(dayDiff('2026-03-08', '2026-03-07')).toBe(-1);
  });
});

describe('janela UTC do ano e validação de fuso', () => {
  test('a janela cobre o ano civil inteiro nos fusos extremos (-12 e +14)', () => {
    const { from, to } = yearWindowUtc(2026);
    expect(from).toBe('2025-12-30T00:00:00.000Z');
    expect(to).toBe('2027-01-03T00:00:00.000Z');
    // 1º/jan 00:00 em +14 é 31/dez 10:00Z; 31/dez 23:59 em -12 é 1º/jan 11:59Z: ambos dentro da janela.
    expect(Date.parse('2026-12-31T10:00:00Z')).toBeGreaterThanOrEqual(Date.parse(from));
    expect(Date.parse('2027-01-01T11:59:00Z')).toBeLessThan(Date.parse(to));
  });

  test('isValidTimeZone aceita nomes IANA e recusa lixo', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('localDate: atalho por deslocamento do dia bate com o Intl', () => {
  const exact = (at: Date, tz: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
  };

  // Fusos com horário de verão, meia hora, 45 minutos e virada de data; passo primo para cair em horas variadas.
  const zones = ['America/Sao_Paulo', 'America/New_York', 'Europe/Lisbon', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Pacific/Kiritimati', 'Pacific/Apia', 'UTC'];

  test('um ano inteiro de instantes, incluindo os dias de virada de horário', () => {
    const start = Date.UTC(2024, 0, 1);
    for (const tz of zones) {
      for (let ms = start; ms < start + 366 * 86_400_000; ms += 7_919_000) {
        const at = new Date(ms);
        expect(`${tz} ${at.toISOString()} ${localDate(at, tz)}`).toBe(`${tz} ${at.toISOString()} ${exact(at, tz)}`);
      }
    }
  });

  test('minuto a minuto em volta da virada de horário de verão (Nova York, março e novembro de 2024)', () => {
    for (const around of [Date.UTC(2024, 2, 10, 7), Date.UTC(2024, 10, 3, 6)]) {
      for (let ms = around - 26 * 3_600_000; ms < around + 26 * 3_600_000; ms += 60_000) {
        const at = new Date(ms);
        expect(localDate(at, 'America/New_York')).toBe(exact(at, 'America/New_York'));
      }
    }
  });

  test('fora de 1970–2100 usa o caminho exato', () => {
    expect(localDate('1969-12-31T23:30:00Z', 'America/Sao_Paulo')).toBe('1969-12-31');
    expect(localDate('2150-06-01T02:00:00Z', 'America/Sao_Paulo')).toBe('2150-05-31');
  });
});
