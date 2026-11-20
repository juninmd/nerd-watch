import { getTvmazePerson, type TvmazePersonDto } from '../api/index.ts';
import { backLinkHtml } from '../ui/back-link.ts';
import { escapeHtml, initials } from '../ui/card.ts';
import { pluralize } from '../ui/pluralize.ts';
import { titlePath } from '../ui/title-link.ts';
import { dateLabel } from './tvmaze-view.ts';
import { renderTitleError } from './title-error.ts';

const creditsHtml = (heading: string, credits: TvmazePersonDto['cast']): string => {
  if (credits.length === 0) return '';
  // Um mesmo show pode aparecer várias vezes (vários personagens): agrupa e junta os papéis.
  const byShow = new Map<number, { name: string; roles: string[] }>();
  for (const c of credits) {
    const entry = byShow.get(c.showId) ?? { name: c.showName, roles: [] };
    if (c.role && !entry.roles.includes(c.role)) entry.roles.push(c.voice ? `${c.role} (voz)` : c.role);
    byShow.set(c.showId, entry);
  }
  const rows = [...byShow.entries()]
    .map(([id, e]) => `<a class="tvm-credit" href="#${titlePath('tvmaze', 'tv', String(id))}"><strong>${escapeHtml(e.name)}</strong>${e.roles.length ? `<span class="dim">${escapeHtml(e.roles.join(', '))}</span>` : ''}</a>`)
    .join('');
  return `<div class="section-head"><h2>${heading} <span class="dim">· ${pluralize(byShow.size, 'série', 'séries')}</span></h2></div><div class="tvm-credits">${rows}</div>`;
};

const ageLabel = (p: TvmazePersonDto): string | null => {
  if (!p.birthday) return null;
  const end = p.deathday ? new Date(`${p.deathday}T00:00:00`) : new Date();
  const born = new Date(`${p.birthday}T00:00:00`);
  const years = end.getFullYear() - born.getFullYear() - (end < new Date(end.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
  return years >= 0 ? `${years} anos${p.deathday ? ' ao falecer' : ''}` : null;
};

/** Página de uma pessoa da TVmaze: foto, dados e créditos de elenco e equipe (cada série leva à ficha dela). */
export const renderTvmazePerson = (host: HTMLElement, id: string): void => {
  const root = document.createElement('div');
  host.replaceChildren(root);
  root.innerHTML = `<div class="skeleton" style="height:240px;border-radius:20px"></div>`;
  const load = () => {
    getTvmazePerson(id)
      .then((p) => {
        if (!root.isConnected) return;
        const facts = [
          p.birthday ? `nasc. ${dateLabel(p.birthday)}` : null,
          p.deathday ? `faleceu em ${dateLabel(p.deathday)}` : null,
          ageLabel(p),
          p.country,
          p.gender,
        ].filter((f): f is string => Boolean(f));
        root.innerHTML = `
          ${backLinkHtml('#/search', 'Voltar', true)}
          <div class="tvm-person-head">
            ${p.imageUrl ? `<img class="tvm-photo big" src="${escapeHtml(p.imageUrl)}" alt="" decoding="async" />` : `<span class="tvm-photo big tvm-photo-empty" aria-hidden="true">${escapeHtml(initials(p.name))}</span>`}
            <div>
              <h1 class="view-title">${escapeHtml(p.name)}</h1>
              <p class="view-subtitle">${escapeHtml(facts.join(' · ') || 'sem dados pessoais na TVmaze')}</p>
              ${p.pageUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(p.pageUrl)}" target="_blank" rel="noopener noreferrer">ver na TVmaze</a>` : ''}
            </div>
          </div>
          ${creditsHtml('Atuação', p.cast)}
          ${creditsHtml('Equipe', p.crew)}
          ${p.cast.length + p.crew.length === 0 ? '<div class="empty-state">sem créditos listados</div>' : ''}
          <p class="hint">Dados: <a href="${escapeHtml(p.attribution.url)}" target="_blank" rel="noopener noreferrer">TVmaze</a>, licença ${escapeHtml(p.attribution.license ?? 'CC BY-SA')}.</p>`;
      })
      .catch(() => {
        if (root.isConnected) renderTitleError(root, load);
      });
  };
  load();
};
