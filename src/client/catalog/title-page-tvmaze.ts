import { backLinkHtml } from '../ui/back-link.ts';
import { getTvmazeMore, getTvmazeTitle, type TvmazeDetailDto, type TvmazeMoreDto } from '../api/index.ts';
import { akasHtml, castHtml, channelsHtml, crewHtml, dateLabel, episodeBadgesHtml, externalLinksHtml, factsHtml, galleryHtml, metaByEpisode, nextPrevHtml, seasonSummaryHtml } from './tvmaze-view.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { renderSpoilerText } from '../ui/spoiler.ts';
import { renderStatusActions } from '../library/status-actions.ts';
import { renderTitleError } from './title-error.ts';
import { pluralize } from '../ui/pluralize.ts';

const episodeCount = (d: TvmazeDetailDto): number => d.seasons.reduce((n, s) => n + s.episodes.length, 0);

/** Temporadas em `<details>`: nativo, acessível por teclado, sem estado extra. A primeira já vem aberta. */
const seasonsHtml = (d: TvmazeDetailDto): string => {
  if (d.seasons.length === 0) return `<div class="empty-state"><div class="big">${icon('inbox')}</div>sem episódios listados pela TVmaze</div>`;
  return d.seasons
    .map(
      (s, i) => `
      <details class="tvmaze-season"${i === 0 ? ' open' : ''}>
        <summary>${escapeHtml(s.name)} · ${s.episodes.length} ep.</summary>
        <div class="tvmaze-episodes" data-season="${s.seasonNumber}"></div>
      </details>`,
    )
    .join('');
};

const fillEpisodes = (host: HTMLElement, d: TvmazeDetailDto): void => {
  for (const s of d.seasons) {
    const list = host.querySelector<HTMLElement>(`[data-season="${s.seasonNumber}"]`);
    if (!list) continue;
    for (const ep of s.episodes) {
      const row = document.createElement('div');
      row.className = 'episode-row';
      row.dataset.ep = `${s.seasonNumber}:${ep.episodeNumber}`;
      row.innerHTML = `${ep.stillUrl ? `<img class="still" src="${escapeHtml(ep.stillUrl)}" alt="" loading="lazy" decoding="async" />` : ''}<div class="body"><div class="head"><span class="name">${ep.episodeNumber}. ${escapeHtml(ep.name)}</span><span class="date">${ep.airDate ? dateLabel(ep.airDate) : 'data a confirmar'}</span></div><div class="tvm-badges" data-badges></div><div class="overview-slot"></div></div>`;
      row.querySelector('.overview-slot')?.appendChild(renderSpoilerText(ep.overview || 'Sem sinopse.', 'overview'));
      list.appendChild(row);
    }
  }
};

/** Segunda carga (elenco, equipe, galeria…): falha aqui só esconde as seções extras, a ficha básica já está na tela. */
const fillMore = (host: HTMLElement, m: TvmazeMoreDto): void => {
  const set = (sel: string, html: string) => {
    const el = host.querySelector<HTMLElement>(sel);
    if (el) el.innerHTML = html;
  };
  set('#tvm-chips', [...m.genres.map((g) => `<span class="tvm-chip">${escapeHtml(g)}</span>`)].join(''));
  set('#tvm-main-extra', castHtml(m.cast) + crewHtml(m.crew) + galleryHtml(m.images));
  set('#tvm-side-extra', nextPrevHtml(m) + channelsHtml(m) + factsHtml(m) + akasHtml(m));
  set('#tvm-ext-links', externalLinksHtml(m));
  const meta = metaByEpisode(m.episodes);
  for (const row of host.querySelectorAll<HTMLElement>('[data-ep]')) {
    const badges = row.querySelector<HTMLElement>('[data-badges]');
    if (badges) badges.innerHTML = episodeBadgesHtml(meta.get(row.dataset.ep ?? ''));
  }
  for (const det of host.querySelectorAll<HTMLElement>('.tvmaze-season')) {
    const n = Number(det.querySelector<HTMLElement>('[data-season]')?.dataset.season);
    det.querySelector('.tvmaze-episodes')?.insertAdjacentHTML('beforebegin', seasonSummaryHtml(m, n));
  }
};

export const renderTvmazeDetail = (host: HTMLElement, id: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    getTvmazeTitle(id)
      .then((d) => {
        const year = d.premiered?.slice(0, 4) ?? '—';
        host.innerHTML = `
          ${backLinkHtml('#/library', 'Voltar', true)}
          <div class="hero">
            <div class="backdrop" style="filter:blur(24px) brightness(0.5);transform:scale(1.1)"></div>
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
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              <div class="section-head"><h2>Episódios</h2></div>
              ${seasonsHtml(d)}
              <div id="tvm-main-extra"></div>
            </div>
            <div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
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

        fillEpisodes(host, d);
        getTvmazeMore(id)
          .then((m) => fillMore(host, m))
          .catch(() => undefined);

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
