import { addToLibrary, searchTvmazePeople, type CatalogSource, search, type SearchResultDto } from '../api/index.ts';
import { escapeHtml, initials, paintPoster } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { titlePath } from '../ui/title-link.ts';
import { paletteKeyLabel } from '../app/shortcut-keys.ts';
import { personCardHtml } from './tvmaze-view.ts';
import { countByKind, filterByKind, SEARCH_KINDS, type SearchKind } from './search-filter.ts';

/** Selo da fonte: tmdb usa o tipo (filme/série); as demais fontes dizem de onde vem. */
const SOURCE_BADGE: Partial<Record<CatalogSource, string>> = {
  archive: 'domínio público',
  tvmaze: 'série · TVmaze',
  anilist: 'anime · AniList',
};

const resultCard = (r: SearchResultDto): string => `
  <div class="card" tabindex="0" role="link" aria-label="${escapeHtml(r.title)}" data-source="${r.source}" data-media="${r.mediaType}" data-id="${escapeHtml(r.sourceId)}">
    <div class="poster${r.posterUrl ? '' : ' placeholder'}"${r.posterUrl ? ` data-poster="${escapeHtml(r.posterUrl)}"` : ''}>
      ${r.posterUrl ? '' : `<span class="initials">${escapeHtml(initials(r.title))}</span>`}
      <span class="badge badge-corner ${r.source === 'archive' ? 'badge-archive' : 'badge-want'}">${SOURCE_BADGE[r.source] ?? (r.mediaType === 'tv' ? 'série' : 'filme')}</span>
    </div>
    <div class="meta">
      <div class="title">${escapeHtml(r.title)}</div>
      <div class="sub">${r.releaseDate ? r.releaseDate.slice(0, 4) : ''}${r.voteAverage ? ` · ⭐ ${r.voteAverage.toFixed(1)}` : ''}</div>
    </div>
    <button class="btn btn-primary btn-sm" data-add aria-label="Adicionar ${escapeHtml(r.title)} à biblioteca" style="position:absolute;bottom:64px;right:8px;padding:6px 10px;box-shadow:0 4px 12px -2px rgba(0,0,0,.6)">+ biblioteca</button>
  </div>
`;

export const renderSearch = (host: HTMLElement, query: string): void => {
  host.innerHTML = `
    <h1 class="view-title">Buscar</h1>
    <p class="view-subtitle">Filmes, séries e novelas na TMDB, séries na TVmaze, anime no AniList e o acervo de domínio público do Internet Archive.</p>
    <form id="search-form" class="chip-row form-row">
      <input type="search" name="q" class="input input-pill grow" placeholder="Nome do filme, série ou novela" autocomplete="off" aria-label="Buscar no catálogo" value="${escapeHtml(query)}" />
      <button class="btn btn-primary btn-sm" type="submit">buscar</button>
    </form>
    <div class="chip-row" id="search-kinds" role="group" aria-label="tipo de resultado" hidden></div>
    <div id="results"></div>
    <div id="people-results"></div>
  `;
  const kindsEl = host.querySelector('#search-kinds') as HTMLElement;
  const results = host.querySelector('#results') as HTMLElement;
  (host.querySelector('#search-form') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target as HTMLFormElement).get('q')?.toString().trim() ?? '';
    navigate(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  });

  if (!query) {
    results.innerHTML = `<div class="empty-state"><div class="big" aria-hidden="true">${icon('search')}</div>digite o nome de um título acima — ou use <kbd>${paletteKeyLabel(navigator.platform)}</kbd> de qualquer tela</div>`;
    return;
  }

  // Pessoas (elenco e equipe) da TVmaze: busca paralela e opcional, falha não atrapalha os títulos.
  const peopleEl = host.querySelector('#people-results') as HTMLElement;
  searchTvmazePeople(query)
    .then(({ results: people }) => {
      if (people.length === 0) return;
      peopleEl.innerHTML = `<div class="section-head"><h2>Pessoas</h2></div><div class="tvm-people">${people.slice(0, 12).map((p) => personCardHtml(p, p.country, p.birthday ? p.birthday.slice(0, 4) : null)).join('')}</div>`;
    })
    .catch(() => undefined);

  kindsEl.hidden = true;
  results.innerHTML = `<div class="grid">${Array.from({ length: 8 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div>`;

  search(query)
    .then((data) => {
      if (data.results.length === 0) {
        results.innerHTML = `<div class="empty-state"><div class="big" aria-hidden="true">${icon('search')}</div>nada encontrado para "${escapeHtml(query)}"<p class="hint">confira a grafia ou tente o nome original do título</p></div>`;
        return;
      }
      // Filtro por tipo no cliente (padrão de "Descobrir" de apps de streaming): sem nova chamada à API.
      let kind: SearchKind = 'all';
      const counts = countByKind(data.results);
      const paint = () => {
        const shown = filterByKind(data.results, kind);
        results.innerHTML = `<div class="grid">${shown.map(resultCard).join('')}</div>`;
        wire();
      };
      kindsEl.hidden = false;
      kindsEl.innerHTML = SEARCH_KINDS.filter((k) => k.id === 'all' || counts[k.id] > 0)
        .map((k) => `<button type="button" class="chip${k.id === kind ? ' active' : ''}" data-kind="${k.id}" aria-pressed="${k.id === kind}">${k.label} <span class="count">${counts[k.id]}</span></button>`)
        .join('');
      kindsEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
        if (!btn) return;
        kind = btn.dataset.kind as SearchKind;
        for (const b of kindsEl.querySelectorAll<HTMLElement>('[data-kind]')) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        }
        paint();
      });
      const wire = () => {
      for (const el of results.querySelectorAll<HTMLElement>('.card')) {
        const source = el.dataset.source as CatalogSource;
        const mediaType = el.dataset.media as 'movie' | 'tv';
        const id = el.dataset.id as string;
        const poster = el.querySelector<HTMLElement>('.poster[data-poster]');
        if (poster) paintPoster(poster, poster.dataset.poster ?? '', el.getAttribute('aria-label') ?? '');
        const open = () => navigate(titlePath(source, source === 'archive' ? '_' : mediaType, id));
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('[data-add]')) return;
          open();
        });
        // Card é role=link: Enter abre; o botão "+ lista" interno tem o próprio Enter.
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || (e.target as HTMLElement).closest('[data-add]')) return;
          e.preventDefault();
          open();
        });
        el.querySelector('[data-add]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const match = data.results.find((r) => r.source === source && r.sourceId === id);
          if (!match) return;
          addToLibrary({
            source,
            sourceId: id,
            mediaType,
            title: match.title,
            overview: match.overview,
            posterPath: source === 'archive' ? match.posterUrl : match.posterUrl?.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, ''),
            releaseDate: match.releaseDate,
            voteAverage: match.voteAverage,
          })
            .then(() => showToast(`"${match.title}" adicionado à sua lista`))
            .catch(() => showToast('não foi possível adicionar'));
        });
      }
      };
      paint();
    })
    .catch(() => {
      results.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>falha na busca, tente de novo</div>`;
    });
};
