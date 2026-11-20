import type { TvmazePerson, TvmazePersonDto } from '../api/index.ts';
import { dateLabel } from './tvmaze-view.ts';

/** Idade hoje (ou ao falecer). `today` injetável para teste. */
export const ageLabel = (p: Pick<TvmazePerson, 'birthday' | 'deathday'>, today: Date = new Date()): string | null => {
  if (!p.birthday) return null;
  const end = p.deathday ? new Date(`${p.deathday}T00:00:00`) : today;
  const born = new Date(`${p.birthday}T00:00:00`);
  const years = end.getFullYear() - born.getFullYear() - (end < new Date(end.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
  return years >= 0 ? `${years} anos${p.deathday ? ' ao falecer' : ''}` : null;
};

/** Linha de fatos da pessoa (nascimento, morte, idade, país, gênero): só o que a TVmaze preencheu. */
export const personFacts = (p: TvmazePerson, today?: Date): string[] =>
  [p.birthday ? `nasc. ${dateLabel(p.birthday)}` : null, p.deathday ? `faleceu em ${dateLabel(p.deathday)}` : null, ageLabel(p, today), p.country, p.gender].filter(
    (f): f is string => Boolean(f),
  );

export interface GroupedCredit {
  showId: number;
  name: string;
  roles: string[];
}

/** Um mesmo show aparece várias vezes (vários personagens): agrupa e junta os papéis. `exclude` tira a série aberta. */
export const groupCredits = (credits: TvmazePersonDto['cast'], exclude?: number): GroupedCredit[] => {
  const byShow = new Map<number, GroupedCredit>();
  for (const c of credits) {
    if (c.showId === exclude) continue;
    const entry = byShow.get(c.showId) ?? { showId: c.showId, name: c.showName, roles: [] };
    const role = c.role && c.voice ? `${c.role} (voz)` : c.role;
    if (role && !entry.roles.includes(role)) entry.roles.push(role);
    byShow.set(c.showId, entry);
  }
  return [...byShow.values()];
};
