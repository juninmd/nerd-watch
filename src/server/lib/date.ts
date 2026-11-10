/** Lógica de datas pura, sem I/O — o que o calendário testa sem precisar de banco. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `dateIso` cai dentro de [from, from + days], usando apenas a parte de data (sem fuso/hora). */
export const isWithinWindow = (dateIso: string | null, fromIso: string, days: number): boolean => {
  if (!dateIso) return false;
  const date = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date) || Number.isNaN(from)) return false;
  const diffDays = (date - from) / DAY_MS;
  return diffDays >= 0 && diffDays <= days;
};

/** Data local (não UTC): `toISOString()` já vira o dia seguinte à noite em fusos negativos (ex.: Brasil), escondendo lançamentos de hoje.
 *  Aceita `now` só para testes determinísticos; chamadores reais usam o padrão. */
export const todayIso = (now: Date = new Date()): string => {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
