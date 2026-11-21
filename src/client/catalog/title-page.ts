import { backLinkHtml } from '../ui/back-link.ts';
import { type CatalogSource, getTmdbTitle, type TmdbDetailDto } from '../api/index.ts';
import { escapeHtml } from '../ui/card.ts';
import { renderAddToList } from '../lists/add-to-list.ts';
import { icon } from '../ui/icons.ts';
import { renderRefreshMetadata } from '../library/refresh-metadata.ts';
import { trailerFrameHtml } from '../player/trailer-embed.ts';
import { renderStatusActions } from '../library/status-actions.ts';
import { renderTitleStreams } from '../addons/title-streams-panel.ts';
import { stopIfOnPageIn } from '../player/player-dock.ts';
import { releaseTorrentPlayers } from '../player/torrent-player.ts';
import { renderSubtitlesPanel } from '../player/subtitles.ts';
import { renderTitleError } from './title-error.ts';
import { whereToWatchHtml } from './where-to-watch.ts';
import { renderArchiveDetail } from './title-page-archive.ts';
import { renderAnilistDetail } from './title-page-anilist.ts';
import { renderSeasons } from './title-page-seasons.ts';
import { renderTvmazeDetail } from './title-page-tvmaze.ts';
import { renderSourceCompare } from './source-compare-card.ts';
import { attachCollapsingHero } from '../ui/collapsing-hero.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { progressFromMarker } from './episode-browser-model.ts';
import { progressRingHtml } from './title-side-view.ts';

/** Anel "seu progresso" pelo marcador da biblioteca; especiais (temporada 0) ficam fora da conta. */
const tmdbProgressHtml = (d: TmdbDetailDto, marker: EpisodeMarker | null): string => {
  const { watched, total } = progressFromMarker(d.seasons.map((s) => ({ number: s.seasonNumber, count: s.episodeCount })), marker);
  return progressRingHtml(watched, total, marker ? `T${marker.season} · Ep ${marker.episode} é onde você parou` : null);
};

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
    // Re-render (status, metadados, temporada) troca o palco: fecha torrent e vídeo desta página, sem tocar no player minimizado.
    releaseTorrentPlayers(host);
    stopIfOnPageIn(host);
    getTmdbTitle(mediaType, id)
      .then((d) => {
        if (!host.isConnected) return;
        const year = d.releaseDate?.slice(0, 4) ?? '—';
        // Fechamento defensivo: algo pode ter começado a tocar entre o início do `load` e a resposta da TMDB.
        releaseTorrentPlayers(host);
        stopIfOnPageIn(host);
        host.innerHTML = `
          ${backLinkHtml('#/library', 'Voltar', true)}
          <div class="hero">
            <div class="backdrop${d.backdropUrl ? '' : ' placeholder'}"${d.backdropUrl ? ` style="background-image:url('${escapeHtml(d.backdropUrl)}')"` : ''}></div>
            <div class="scrim"></div>
            <div class="hero-content">
              <div class="hero-poster"${d.posterUrl ? ` style="background-image:url('${escapeHtml(d.posterUrl)}')"` : ''}>
                ${d.posterUrl ? '' : `<div style="display:grid;place-items:center;height:100%;background:var(--gradient-soft);font-size:34px;font-weight:800">${escapeHtml(initials(d.title))}</div>`}
              </div>
              <div class="hero-info">
                <h1>${escapeHtml(d.title)}</h1>
                <div class="hero-meta">
                  <span>${mediaType === 'tv' ? 'Série' : 'Filme'}</span>
                  <span>${escapeHtml(year)}</span>
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
              ${trailerFrameHtml(d.trailerKey)}
              <div id="addon-stream-player"></div>
              <div id="seasons-section"></div>
              ${mediaType === 'movie' ? `<div class="empty-state"><div class="big">${icon('film')}</div>filmes protegidos por direitos autorais não são reproduzidos dentro do app — use os streamings ao lado, ou confira o acervo de <a href="#/public-domain">domínio público</a> se este título já for livre.</div>` : ''}
            </div>
            <div>
              ${mediaType === 'tv' ? '<div id="prem-progress"></div>' : ''}
              <div class="side-card" id="where-card" tabindex="-1">${whereToWatchHtml(d.watchProviders)}</div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
                <div id="add-to-list" style="margin-top:12px"></div>
                <div id="refresh-metadata" style="margin-top:12px"></div>
              </div>
              ${mediaType === 'tv' ? '<div class="side-card"><h3>Fontes</h3><div id="source-compare"></div></div>' : ''}
              <div class="side-card">
                <h3>Streams dos addons</h3>
                <div id="addon-streams-panel"></div>
              </div>
              <div class="side-card">
                <h3>Legendas</h3>
                <div id="subtitles-panel"></div>
              </div>
            </div>
          </div>
        `;

        attachCollapsingHero(host.querySelector('.hero') as HTMLElement);

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
            rewatchCount: d.library?.rewatch_count ?? 0,
            onChange: () => load(),
          }),
        );

        (host.querySelector('#add-to-list') as HTMLElement).appendChild(renderAddToList(d.titleId));
        (host.querySelector('#refresh-metadata') as HTMLElement).appendChild(renderRefreshMetadata(d.titleId, () => load()));

        if (mediaType === 'tv') {
          renderSourceCompare(host.querySelector('#source-compare') as HTMLElement, id);
          const ring = host.querySelector('#prem-progress') as HTMLElement;
          const lib = d.library;
          ring.innerHTML = tmdbProgressHtml(d, lib?.current_season != null && lib.current_episode != null ? { season: lib.current_season, episode: lib.current_episode } : null);
          renderSeasons(host.querySelector('#seasons-section') as HTMLElement, id, d.title, d.seasons, d.titleId, d.library, load, (m) => {
            ring.innerHTML = tmdbProgressHtml(d, m);
          });
        }

        renderTitleStreams(
          host.querySelector('#addon-streams-panel') as HTMLElement,
          {
            tmdbId: Number(id),
            mediaType,
            season: mediaType === 'tv' ? (d.library?.current_season ?? null) : null,
            episode: mediaType === 'tv' ? (d.library?.current_episode ?? null) : null,
            // Nome/ano permitem achar o item em addons que só entendem id próprio (`afhd:…`).
            title: d.title,
            year: d.releaseDate?.slice(0, 4) ?? null,
          },
          {
            title: d.title,
            posterUrl: d.posterUrl,
            // O cartão dos streams fica na coluna lateral; o vídeo vai para a principal, acima dos episódios.
            playerHost: host.querySelector('#addon-stream-player') as HTMLElement,
          },
        );

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
      .catch(() => renderTitleError(host, load));
  };

  load();
};
