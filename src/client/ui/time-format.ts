/** Datas e durações do cliente. Datas são sempre locais: toISOString() usa UTC e viraria o dia à noite no Brasil. */

const pad = (n: number): string => String(n).padStart(2, '0');

export const localIsoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (d: Date, days: number): Date => {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
};

export interface DayCell {
  iso: string;
  date: Date;
  count: number;
}

/** `n` dias consecutivos a partir de `from`, cada um com quantas entradas caem nele. */
export const weekCells = (from: Date, n: number, entries: Array<{ date: string }>): DayCell[] =>
  Array.from({ length: n }, (_, i) => {
    const date = addDays(from, i);
    const iso = localIsoDate(date);
    return { iso, date, count: entries.filter((e) => e.date === iso).length };
  });

export const formatDuration = (seconds: number | null): string | null => {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h${pad(m)}` : `${m}:${pad(s)}`;
};
