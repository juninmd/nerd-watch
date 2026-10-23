import { addToLibrary, type CatalogSource, search, type SearchResultDto } from '../api.ts';
import { escapeHtml, initials, paintPoster } from '../components/card.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { titlePath } from '../title-link.ts';

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
    <button class="btn btn-primary btn-sm" data-add style="position:absolute;bottom:64px;right:8px;padding:6px 10px;box-shadow:0 4px 12px -2px rgba(0,0,0,.6)">+ lista</button>
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
    <div id="results"></div>
  `;
  const results = host.querySelector('#results') as HTMLElement;
  (host.querySelector('#search-form') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target as HTMLFormElement).get('q')?.toString().trim() ?? '';
    navigate(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  });

  if (!query) {
    results.innerHTML = `<div class="empty-state"><div class="big">🔎</div>digite o nome de um título acima — ou use <kbd>Ctrl K</kbd> de qualquer tela</div>`;
    return;
  }

  results.innerHTML = `<div class="grid">${Array.from({ length: 8 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div>`;

  search(query)
    .then((data) => {
      if (data.results.length === 0) {
        results.innerHTML = `<div class="empty-state"><div class="big">🕵️</div>nada encontrado para "${escapeHtml(query)}"</div>`;
        return;
      }
      results.innerHTML = `<div class="grid">${data.results.map(resultCard).join('')}</div>`;

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
    })
    .catch(() => {
      results.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>falha na busca, tente de novo</div>`;
    });
};
