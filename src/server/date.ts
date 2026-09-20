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

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
