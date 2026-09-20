import { addToLibrary, search, type SearchResultDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { navigate } from '../router.ts';
import { showToast } from '../state.ts';
import { titlePath } from '../title-link.ts';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const resultCard = (r: SearchResultDto): string => `
  <div class="card" data-source="${r.source}" data-media="${r.mediaType}" data-id="${escapeHtml(r.sourceId)}">
    <div class="poster${r.posterUrl ? '' : ' placeholder'}"${r.posterUrl ? ` style="background-image:url('${r.posterUrl}')"` : ''}>
      ${r.posterUrl ? '' : `<span class="initials">${initials(r.title)}</span>`}
      <span class="badge badge-corner ${r.source === 'archive' ? 'badge-archive' : 'badge-want'}">${
        r.source === 'archive' ? 'domínio público' : r.mediaType === 'tv' ? 'série' : 'filme'
      }</span>
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
    <p class="view-subtitle">Filmes, séries e novelas na TMDB, mais o acervo de domínio público do Internet Archive.</p>
    <div id="results"></div>
  `;
  const results = host.querySelector('#results') as HTMLElement;

  if (!query) {
    results.innerHTML = `<div class="empty-state"><div class="big">🔎</div>digite algo na busca no topo da tela</div>`;
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
        const source = el.dataset.source as 'tmdb' | 'archive';
        const mediaType = el.dataset.media as 'movie' | 'tv';
        const id = el.dataset.id as string;
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('[data-add]')) return;
          navigate(titlePath(source, source === 'archive' ? '_' : mediaType, id));
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
      results.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>falha na busca, tente de novo</div>`;
    });
};
