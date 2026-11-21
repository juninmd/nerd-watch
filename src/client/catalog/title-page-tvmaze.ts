import { backLinkHtml } from '../ui/back-link.ts';
import { getTvmazeMore, getTvmazeTitle, type TvmazeDetailDto, type TvmazeEpisodeMeta, type TvmazeMoreDto } from '../api/index.ts';
import { akasHtml, channelsHtml, crewHtml, episodeTypeTag, externalLinksHtml, factsHtml, galleryHtml, metaByEpisode, nextPrevHtml, seasonSummaryText } from './tvmaze-view.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { renderStatusActions } from '../library/status-actions.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { markThrough } from '../library/mark-progress.ts';
import { renderTitleError } from './title-error.ts';
import { pluralize } from '../ui/pluralize.ts';
import { attachCollapsingHero } from '../ui/collapsing-hero.ts';
import { renderEpisodeBrowser } from './episode-browser.ts';
import { type EpisodeView, progressFromMarker } from './episode-browser-model.ts';
import { castSideHtml, progressRingHtml, seasonsSideHtml } from './title-side-view.ts';
import { openPersonModal } from './person-modal.ts';

const episodeCount = (d: TvmazeDetailDto): number => d.seasons.reduce((n, s) => n + s.episodes.length, 0);

const markerOf = (d: TvmazeDetailDto): EpisodeMarker | null =>
  d.library?.current_season != null && d.library.current_episode != null ? { season: d.library.current_season, episode: d.library.current_episode } : null;

/** Segunda carga (elenco, equipe, galeria…): falha aqui só esconde as seções extras, a ficha básica já está na tela. */
const fillMore = (host: HTMLElement, m: TvmazeMoreDto, counts: Map<number, number>): void => {
  const set = (sel: string, html: string) => {
    const el = host.querySelector<HTMLElement>(sel);
    if (el) el.innerHTML = html;
  };
  set('#tvm-chips', m.genres.map((g) => `<span class="tvm-chip">${escapeHtml(g)}</span>`).join(''));
  set('#tvm-main-extra', crewHtml(m.crew) + galleryHtml(m.images));
  set('#tvm-cast', castSideHtml(m.cast));
  set('#tvm-seasons', seasonsSideHtml(m, counts));
  set('#tvm-side-extra', nextPrevHtml(m) + channelsHtml(m) + factsHtml(m) + akasHtml(m));
  set('#tvm-ext-links', externalLinksHtml(m));
};

export const renderTvmazeDetail = (host: HTMLElement, id: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;
  // Cada recarga (mudou o status) repinta a ficha: o ouvinte de cliques da anterior sai junto.
  let clicks: AbortController | null = null;

  const load = () => {
    getTvmazeTitle(id)
      .then((d) => {
        const year = d.premiered?.slice(0, 4) ?? '—';
        let marker = markerOf(d);
        let more: TvmazeMoreDto | null = null;
        let meta = new Map<string, TvmazeEpisodeMeta>();
        const counts = new Map(d.seasons.map((s) => [s.seasonNumber, s.episodes.length]));
        host.innerHTML = `
          ${backLinkHtml('#/library', 'Voltar', true)}
          <div class="hero">
            <div class="backdrop backdrop-blur"></div>
            <div class="scrim"></div>
            <div class="hero-content">
              <div class="hero-poster"></div>
              <div class="hero-info">
                <h1>${escapeHtml(d.title)}</h1>
                <div class="hero-meta">
                  <span>Série</span>
                  <span>${year}</span>
                  ${d.voteAverage ? `<span>⭐ ${d.voteAverage.toFixed(1)}</span>` : ''}
                  ${d.status ? `<span>${escapeHtml(d.status)}</span>` : ''}
                  <span>${pluralize(episodeCount(d), 'episódio', 'episódios')}</span>
                </div>
                <div class="tvm-chips" id="tvm-chips"></div>
                <p class="hero-overview">${escapeHtml(d.overview || 'Sem sinopse disponível.')}</p>
                <div class="hero-actions"><button class="btn btn-primary" type="button" data-jump-episodes>${icon('play', 'sm')} Episódios</button></div>
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              <div id="tvm-episodes"></div>
              <div id="tvm-main-extra"></div>
            </div>
            <div>
              <div id="tvm-progress"></div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
              <div id="tvm-cast"></div>
              <div id="tvm-seasons"></div>
              <div id="tvm-side-extra"></div>
              <div class="side-card">
                <h3>Fonte</h3>
                <div id="tvm-ext-links" style="margin-bottom:10px"></div>
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(d.pageUrl ?? d.attribution.url)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center;margin-bottom:8px">ver na TVmaze</a>
                ${d.officialUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(d.officialUrl)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center">site oficial da série</a>` : ''}
                <p class="hint" style="margin-top:10px">Dados: <a href="${escapeHtml(d.attribution.url)}" target="_blank" rel="noopener noreferrer">TVmaze</a>, licença ${escapeHtml(d.attribution.license ?? 'CC BY-SA')}.</p>
              </div>
            </div>
          </div>
        `;

        // Via CSSOM, não innerHTML: a URL nunca é parseada como marcação (mesmo critério do detalhe do Archive).
        if (d.posterUrl) {
          (host.querySelector('.backdrop') as HTMLElement).style.backgroundImage = `url("${d.posterUrl}")`;
          (host.querySelector('.hero-poster') as HTMLElement).style.backgroundImage = `url("${d.posterUrl}")`;
        }
        attachCollapsingHero(host.querySelector('.hero') as HTMLElement);

        const progressEl = host.querySelector('#tvm-progress') as HTMLElement;
        const drawProgress = () => {
          const { watched, total } = progressFromMarker([...counts].map(([number, count]) => ({ number, count })), marker);
          const next = more?.nextEpisode ? `T${more.nextEpisode.season} · E${more.nextEpisode.number ?? '?'} — ${more.nextEpisode.name}` : marker ? `parou em T${marker.season} · Ep ${marker.episode}` : null;
          progressEl.innerHTML = progressRingHtml(watched, total, next);
        };

        const episodesEl = host.querySelector('#tvm-episodes') as HTMLElement;
        const browser = renderEpisodeBrowser(episodesEl, {
          seriesTitle: d.title,
          seasons: d.seasons.map((s) => ({ number: s.seasonNumber, name: s.name, count: s.episodes.length })),
          initialSeason: marker?.season ?? d.seasons.find((s) => s.seasonNumber > 0)?.seasonNumber ?? 1,
          load: (n) =>
            Promise.resolve(
              (d.seasons.find((s) => s.seasonNumber === n)?.episodes ?? []).map((ep): EpisodeView => {
                const m = meta.get(`${n}:${ep.episodeNumber}`);
                return { season: n, number: ep.episodeNumber, name: ep.name, airDate: ep.airDate, runtime: ep.runtime, overview: ep.overview, stillUrl: ep.stillUrl, rating: m?.rating ?? null, tag: episodeTypeTag(m) };
              }),
            ),
          marker: () => marker,
          streams: (ep) =>
            more?.externals.imdb
              ? { imdbId: more.externals.imdb, mediaType: 'tv', season: ep.season, episode: ep.number }
              : { unavailable: more ? 'Sem id do IMDb para esta série: não dá para buscar streams.' : 'Ainda carregando os dados da série; tente de novo em instantes.' },
          onMark: (ep) =>
            markThrough(d.titleId, ep.season, ep.number, (m) => {
              marker = m;
              browser.refresh();
              drawProgress();
            }),
          seasonNote: (n) => (more ? seasonSummaryText(more, n) : ''),
        });
        drawProgress();

        getTvmazeMore(id)
          .then((m) => {
            if (!host.isConnected) return;
            more = m;
            meta = metaByEpisode(m.episodes);
            fillMore(host, m, counts);
            drawProgress();
            browser.reload();
          })
          .catch(() => undefined);

        host.querySelector('[data-jump-episodes]')?.addEventListener('click', () => {
          const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
          episodesEl.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
          episodesEl.querySelector<HTMLElement>('.season-tabs .chip.active')?.focus({ preventScroll: true });
        });

        // Lateral: elenco abre o modal da pessoa; temporada da linha do tempo leva à aba dela.
        clicks?.abort();
        clicks = new AbortController();
        host.addEventListener('click', (e) => {
          const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-person], button[data-cast-more], button[data-season-jump]');
          if (!t) return;
          if (t.dataset.person && more) {
            const c = more.cast.find((x) => String(x.person.id) === t.dataset.person);
            if (c) openPersonModal({ id: c.person.id, name: c.person.name, imageUrl: c.person.imageUrl, role: c.character?.name ?? null, seriesTitle: d.title, currentShowId: Number(id) });
          } else if ('castMore' in t.dataset) {
            const open = t.getAttribute('aria-expanded') !== 'true';
            for (const li of host.querySelectorAll<HTMLElement>('#prem-cast-list [data-more]')) li.hidden = !open;
            t.setAttribute('aria-expanded', String(open));
            t.textContent = open ? 'Mostrar menos' : `Ver elenco completo (+${host.querySelectorAll('#prem-cast-list [data-more]').length})`;
          } else if (t.dataset.seasonJump) {
            browser.selectSeason(Number(t.dataset.seasonJump));
            const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
            episodesEl.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
            episodesEl.querySelector<HTMLElement>('.season-tabs .chip.active')?.focus({ preventScroll: true });
          }
        }, { signal: clicks.signal });

        (host.querySelector('#status-actions') as HTMLElement).appendChild(
          renderStatusActions({
            titleId: d.titleId,
            entryId: d.library?.id ?? null,
            watchStatus: d.library?.watch_status ?? null,
            rating: d.library?.rating ?? null,
            rewatchCount: d.library?.rewatch_count ?? 0,
            onChange: () => load(),
          }),
        );
      })
      .catch(() => renderTitleError(host, load));
  };

  load();
};
