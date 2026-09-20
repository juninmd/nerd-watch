import { getTmdbTitle } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { renderArchiveDetail } from './media-detail-archive.ts';
import { renderSeasons } from './media-detail-seasons.ts';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export const renderTitleDetail = (
  host: HTMLElement,
  source: 'tmdb' | 'archive',
  mediaType: 'movie' | 'tv' | '_',
  id: string,
): void => {
  if (source === 'archive') {
    renderArchiveDetail(host, id);
    return;
  }
  renderTmdbDetail(host, mediaType as 'movie' | 'tv', id);
};

const renderTmdbDetail = (host: HTMLElement, mediaType: 'movie' | 'tv', id: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    getTmdbTitle(mediaType, id)
      .then((d) => {
        const year = d.releaseDate?.slice(0, 4) ?? '—';
        const providersHtml = (label: string, list: typeof d.watchProviders.flatrate) =>
          list.length
            ? `<div style="margin-bottom:10px"><div class="hint" style="margin-bottom:6px">${label}</div><div class="provider-row">${list
                .map((p) => (p.logoUrl ? `<div class="provider-logo" title="${escapeHtml(p.name)}"><img src="${p.logoUrl}" alt="${escapeHtml(p.name)}" /></div>` : ''))
                .join('')}</div></div>`
            : '';

        host.innerHTML = `
          <div class="hero">
            <div class="backdrop${d.backdropUrl ? '' : ' placeholder'}"${d.backdropUrl ? ` style="background-image:url('${d.backdropUrl}')"` : ''}></div>
            <div class="scrim"></div>
            <div class="hero-content">
              <div class="hero-poster"${d.posterUrl ? ` style="background-image:url('${d.posterUrl}')"` : ''}>
                ${d.posterUrl ? '' : `<div style="display:grid;place-items:center;height:100%;background:var(--gradient-soft);font-size:34px;font-weight:800">${initials(d.title)}</div>`}
              </div>
              <div class="hero-info">
                <h1>${escapeHtml(d.title)}</h1>
                <div class="hero-meta">
                  <span>${mediaType === 'tv' ? 'Série' : 'Filme'}</span>
                  <span>${year}</span>
                  ${d.voteAverage ? `<span>⭐ ${d.voteAverage.toFixed(1)}</span>` : ''}
                  <span>${escapeHtml(d.status)}</span>
                </div>
                <p class="hero-overview">${escapeHtml(d.overview || 'Sem sinopse disponível.')}</p>
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              ${d.trailerKey ? `<div class="trailer-frame"><iframe src="https://www.youtube.com/embed/${d.trailerKey}" allowfullscreen title="trailer"></iframe></div>` : ''}
              <div id="seasons-section"></div>
              ${mediaType === 'movie' ? `<div class="empty-state"><div class="big">🎬</div>filmes protegidos por direitos autorais não são reproduzidos dentro do app — use os streamings ao lado, ou confira o acervo de <a href="#/public-domain">domínio público</a> se este título já for livre.</div>` : ''}
            </div>
            <div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
              <div class="side-card">
                <h3>Onde assistir</h3>
                ${providersHtml('Incluso na assinatura', d.watchProviders.flatrate)}
                ${providersHtml('Alugar', d.watchProviders.rent)}
                ${providersHtml('Comprar', d.watchProviders.buy)}
                ${
                  d.watchProviders.link
                    ? `<a class="btn btn-primary btn-sm" href="${d.watchProviders.link}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center;margin-top:6px">abrir no TMDB</a>`
                    : `<p class="hint">sem streamings listados para sua região</p>`
                }
              </div>
            </div>
          </div>
        `;

        const statusHost = host.querySelector('#status-actions') as HTMLElement;
        statusHost.appendChild(
          renderStatusActions({
            titleId: d.titleId,
            entryId: d.library?.id ?? null,
            watchStatus: d.library?.watch_status ?? null,
            rating: d.library?.rating ?? null,
            onChange: () => load(),
          }),
        );

        if (mediaType === 'tv') {
          renderSeasons(host.querySelector('#seasons-section') as HTMLElement, id, d.seasons, d.titleId, d.library, load);
        }
      })
      .catch((err) => {
        host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>${escapeHtml(err instanceof Error ? err.message : 'falha ao carregar')}</div>`;
      });
  };

  load();
};
