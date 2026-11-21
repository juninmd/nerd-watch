import { getTvmazePerson, type TvmazePersonDto } from '../api/index.ts';
import { backLinkHtml } from '../ui/back-link.ts';
import { escapeHtml, initials } from '../ui/card.ts';
import { pluralize } from '../ui/pluralize.ts';
import { titlePath } from '../ui/title-link.ts';
import { renderTitleError } from './title-error.ts';
import { groupCredits, personFacts } from './person-facts.ts';

const creditsHtml = (heading: string, credits: TvmazePersonDto['cast']): string => {
  if (credits.length === 0) return '';
  const byShow = groupCredits(credits);
  const rows = byShow
    .map((e) => `<a class="tvm-credit" href="#${titlePath('tvmaze', 'tv', String(e.showId))}"><strong>${escapeHtml(e.name)}</strong>${e.roles.length ? `<span class="dim">${escapeHtml(e.roles.join(', '))}</span>` : ''}</a>`)
    .join('');
  return `<div class="section-head"><h2>${heading} <span class="dim">· ${pluralize(byShow.length, 'série', 'séries')}</span></h2></div><div class="tvm-credits">${rows}</div>`;
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
        const facts = personFacts(p);
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
