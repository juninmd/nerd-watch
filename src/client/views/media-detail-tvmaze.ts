import { getTvmazeTitle, type TvmazeDetailDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderSpoilerText } from '../components/spoiler.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { renderTitleError } from '../components/title-error.ts';
import { pluralize } from '../pluralize.ts';

const dateLabel = (iso: string | null): string => {
  if (!iso) return 'data a confirmar';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const episodeCount = (d: TvmazeDetailDto): number => d.seasons.reduce((n, s) => n + s.episodes.length, 0);

/** Temporadas em `<details>`: nativo, acessível por teclado, sem estado extra. A primeira já vem aberta. */
const seasonsHtml = (d: TvmazeDetailDto): string => {
  if (d.seasons.length === 0) return '<div class="empty-state"><div class="big">📭</div>sem episódios listados pela TVmaze</div>';
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
      row.innerHTML = `<div class="body"><div class="head"><span class="name">${ep.episodeNumber}. ${escapeHtml(ep.name)}</span><span class="date">${dateLabel(ep.airDate)}</span></div><div class="overview-slot"></div></div>`;
      row.querySelector('.overview-slot')?.appendChild(renderSpoilerText(ep.overview || 'Sem sinopse.', 'overview'));
      list.appendChild(row);
    }
  }
};

export const renderTvmazeDetail = (host: HTMLElement, id: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    getTvmazeTitle(id)
      .then((d) => {
        const year = d.premiered?.slice(0, 4) ?? '—';
        host.innerHTML = `
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
                <p class="hero-overview">${escapeHtml(d.overview || 'Sem sinopse disponível.')}</p>
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              <div class="section-head"><h2>📺 Episódios</h2></div>
              ${seasonsHtml(d)}
            </div>
            <div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
              <div class="side-card">
                <h3>Fonte</h3>
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
