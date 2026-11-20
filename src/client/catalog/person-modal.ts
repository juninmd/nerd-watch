import { getTvmazePersonCard, type TvmazePersonCardDto } from '../api/index.ts';
import { escapeHtml, initials } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { titlePath } from '../ui/title-link.ts';
import { personFacts } from './person-facts.ts';

export interface PersonModalSeed {
  id: number;
  name: string;
  imageUrl: string | null;
  /** Personagem na série aberta. */
  role: string | null;
  seriesTitle: string;
  /** Série aberta: sai da lista de "outras séries". */
  currentShowId: number | null;
}

const showsHtml = (card: TvmazePersonCardDto, currentShowId: number | null): string => {
  const shows = card.shows.filter((s) => s.showId !== currentShowId);
  if (shows.length === 0) return '<p class="hint">Sem outras séries listadas na TVmaze.</p>';
  return `<ul class="prem-credits">${shows
    .map(
      (s) => `<li><a href="#${titlePath('tvmaze', 'tv', String(s.showId))}" data-close-nav>
        <span class="prem-credit-poster">${s.posterUrl ? `<img src="${escapeHtml(s.posterUrl)}" alt="" loading="lazy" decoding="async" />` : `<span aria-hidden="true">${escapeHtml(initials(s.name))}</span>`}${s.voice ? '<span class="prem-voice">voz</span>' : ''}</span>
        <strong>${escapeHtml(s.name)}</strong>
        ${s.role ? `<span class="dim">${escapeHtml(s.role)}</span>` : ''}
        <span class="dim mono">${escapeHtml([s.year, s.rating ? `★ ${s.rating.toFixed(1)}` : null].filter(Boolean).join(' · '))}</span>
      </a></li>`,
    )
    .join('')}</ul>`;
};

/** Modal de uma pessoa do elenco: foto e personagem na hora; dados, mini bio e outras séries assim que chegam. */
export const openPersonModal = (seed: PersonModalSeed): void => {
  document.querySelector('dialog.person-modal')?.remove();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const d = document.createElement('dialog');
  d.className = 'dialog person-modal';
  d.setAttribute('closedby', 'any');
  d.setAttribute('aria-labelledby', 'person-modal-name');
  d.innerHTML = `
    <div class="person-modal-head">
      ${seed.imageUrl ? `<img class="prem-portrait" src="${escapeHtml(seed.imageUrl)}" alt="" decoding="async" />` : `<span class="prem-portrait prem-avatar-empty" aria-hidden="true">${escapeHtml(initials(seed.name))}</span>`}
      <div class="person-modal-id">
        <span class="eyebrow">Elenco · ${escapeHtml(seed.seriesTitle)}</span>
        <h2 id="person-modal-name">${escapeHtml(seed.name)}</h2>
        ${seed.role ? `<span class="dim">${escapeHtml(seed.role)}</span>` : ''}
        <span class="hint" data-facts></span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-close aria-label="Fechar">${icon('x', 'sm')}</button>
    </div>
    <div class="person-modal-body" aria-busy="true">
      <div class="skeleton" style="height:64px"></div>
      <div class="skeleton" style="height:180px;margin-top:12px"></div>
    </div>`;
  document.body.appendChild(d);

  const body = d.querySelector('.person-modal-body') as HTMLElement;
  getTvmazePersonCard(seed.id)
    .then((card) => {
      if (!d.isConnected) return;
      (d.querySelector('[data-facts]') as HTMLElement).textContent = personFacts(card.person).join(' · ');
      body.removeAttribute('aria-busy');
      body.innerHTML = `
        ${
          card.bio
            ? `<section aria-label="Biografia"><p class="person-bio">${escapeHtml(card.bio.extract)}</p>
               <p class="hint">Resumo da <a href="${escapeHtml(card.bio.url)}" target="_blank" rel="noopener noreferrer">Wikipédia${card.bio.lang === 'en' ? ' (em inglês)' : ''}</a>, licença CC BY-SA.</p></section>`
            : '<p class="hint">Sem biografia confiável encontrada para esta pessoa.</p>'
        }
        <section aria-labelledby="person-modal-shows"><h3 id="person-modal-shows">Outras séries <span class="dim">${card.person.cast.length} créditos na TV</span></h3>${showsHtml(card, seed.currentShowId)}</section>
        <p class="hint">Filmes não aparecem: a TVmaze só cobre TV. <a href="#/person/tvmaze/${seed.id}" data-close-nav>Ver página completa</a> · dados: <a href="${escapeHtml(card.attribution.url)}" target="_blank" rel="noopener noreferrer">TVmaze</a>.</p>`;
    })
    .catch(() => {
      if (!d.isConnected) return;
      body.removeAttribute('aria-busy');
      body.innerHTML = `<p class="hint" role="alert">Não foi possível carregar os dados agora. <a href="#/person/tvmaze/${seed.id}" data-close-nav>Abrir a página da pessoa</a></p>`;
    });

  d.addEventListener('click', (e) => {
    if (e.target === d) return d.close();
    const t = e.target as HTMLElement;
    // Link interno troca a rota por trás: fecha o modal junto para não ficar por cima da tela nova.
    if (t.closest('[data-close], [data-close-nav]')) d.close();
  });
  d.addEventListener('close', () => {
    d.remove();
    if (opener?.isConnected) opener.focus();
  });
  d.showModal();
  d.querySelector<HTMLElement>('[data-close]')?.focus();
};
