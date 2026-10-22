import { type CatalogSource, getTmdbTitle } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { renderSubtitlesPanel } from '../components/subtitles.ts';
import { whereToWatchHtml } from '../components/where-to-watch.ts';
import { renderArchiveDetail } from './media-detail-archive.ts';
import { renderAnilistDetail } from './media-detail-anilist.ts';
import { renderSeasons } from './media-detail-seasons.ts';
import { renderTvmazeDetail } from './media-detail-tvmaze.ts';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export const renderTitleDetail = (
  host: HTMLElement,
  source: CatalogSource,
  mediaType: 'movie' | 'tv' | '_',
  id: string,
): void => {
  if (source === 'archive') {
    renderArchiveDetail(host, id);
    return;
  }
  if (source === 'tvmaze') {
    renderTvmazeDetail(host, id);
    return;
  }
  if (source === 'anilist') {
    renderAnilistDetail(host, id);
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
                <div class="hero-actions">
                  <button class="btn btn-primary" type="button" data-jump="where-card">Onde assistir</button>
                  ${d.trailerKey ? '<button class="btn btn-ghost" type="button" data-jump="trailer">Trailer</button>' : ''}
                </div>
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              ${d.trailerKey ? `<div class="trailer-frame" id="trailer" tabindex="-1"><iframe src="https://www.youtube.com/embed/${d.trailerKey}" allowfullscreen title="trailer"></iframe></div>` : ''}
              <div id="seasons-section"></div>
              ${mediaType === 'movie' ? `<div class="empty-state"><div class="big">🎬</div>filmes protegidos por direitos autorais não são reproduzidos dentro do app — use os streamings ao lado, ou confira o acervo de <a href="#/public-domain">domínio público</a> se este título já for livre.</div>` : ''}
            </div>
            <div>
              <div class="side-card" id="where-card" tabindex="-1">${whereToWatchHtml(d.watchProviders)}</div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
              <div class="side-card">
                <h3>Legendas</h3>
                <div id="subtitles-panel"></div>
              </div>
            </div>
          </div>
        `;

        for (const btn of host.querySelectorAll<HTMLElement>('[data-jump]')) {
          btn.addEventListener('click', () => {
            const target = host.querySelector<HTMLElement>(`#${btn.dataset.jump}`);
            const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
            target?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
            target?.focus({ preventScroll: true });
          });
        }

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

        const subtitlesHost = host.querySelector('#subtitles-panel') as HTMLElement;
        subtitlesHost.appendChild(
          renderSubtitlesPanel({
            tmdbId: Number(id),
            mediaType,
            // Para série, o addon exige `tt…:temporada:episódio`; usamos onde você parou.
            season: mediaType === 'tv' ? (d.library?.current_season ?? null) : null,
            episode: mediaType === 'tv' ? (d.library?.current_episode ?? null) : null,
          }),
        );
      })
      .catch((err) => {
        host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>${escapeHtml(err instanceof Error ? err.message : 'falha ao carregar')}</div>`;
      });
  };

  load();
};
