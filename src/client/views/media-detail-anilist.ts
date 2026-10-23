import { getAnilistTitle, type AnilistDetailDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderStatusActions } from '../components/status-actions.ts';
import { pluralize } from '../pluralize.ts';

const FORMAT_LABEL: Record<string, string> = { TV: 'Série', TV_SHORT: 'Série curta', MOVIE: 'Filme', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MUSIC: 'Música' };

const STATUS_LABEL: Record<string, string> = {
  FINISHED: 'concluído',
  RELEASING: 'em exibição',
  NOT_YET_RELEASED: 'ainda não estreou',
  CANCELLED: 'cancelado',
  HIATUS: 'em hiato',
};

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

const nextEpisodeLine = (d: AnilistDetailDto): string => {
  if (!d.nextEpisode) return '';
  return `<p class="hint" style="margin-top:10px">Próximo episódio: <strong>${d.nextEpisode.episode}</strong> em ${dateLabel(d.nextEpisode.airDate)} (horário local)</p>`;
};

export const renderAnilistDetail = (host: HTMLElement, id: string): void => {
  host.innerHTML = `<div class="skeleton" style="height:320px;border-radius:20px"></div>`;

  const load = () => {
    getAnilistTitle(id)
      .then((d) => {
        const format = d.format ? (FORMAT_LABEL[d.format] ?? d.format) : d.mediaType === 'movie' ? 'Filme' : 'Anime';
        const status = d.status ? (STATUS_LABEL[d.status] ?? d.status.toLowerCase()) : null;
        const subtitle = d.romaji && d.romaji !== d.title ? d.romaji : null;
        host.innerHTML = `
          <div class="hero">
            <div class="backdrop" style="filter:blur(24px) brightness(0.5);transform:scale(1.1)"></div>
            <div class="scrim"></div>
            <div class="hero-content">
              <div class="hero-poster"></div>
              <div class="hero-info">
                <h1>${escapeHtml(d.title)}</h1>
                ${subtitle ? `<p class="view-subtitle" style="margin:0 0 8px">${escapeHtml(subtitle)}</p>` : ''}
                <div class="hero-meta">
                  <span>${escapeHtml(format)}</span>
                  ${d.year ? `<span>${escapeHtml(d.year)}</span>` : ''}
                  ${d.voteAverage ? `<span>⭐ ${d.voteAverage.toFixed(1)}</span>` : ''}
                  ${status ? `<span>${escapeHtml(status)}</span>` : ''}
                  ${d.episodes ? `<span>${pluralize(d.episodes, 'episódio', 'episódios')}</span>` : ''}
                </div>
                <p class="hero-overview">${escapeHtml(d.overview || 'Sem sinopse disponível.')}</p>
                ${nextEpisodeLine(d)}
              </div>
            </div>
          </div>
          <div class="detail-grid">
            <div>
              <p class="view-subtitle">Anime com dados do AniList. O AniList informa só o próximo episódio; a lista de episódios não está disponível aqui.</p>
            </div>
            <div>
              <div class="side-card">
                <h3>Sua lista</h3>
                <div id="status-actions"></div>
              </div>
              <div class="side-card">
                <h3>Fonte</h3>
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(d.pageUrl ?? d.attribution.url)}" target="_blank" rel="noopener noreferrer" style="width:100%;justify-content:center">ver no AniList</a>
              </div>
            </div>
          </div>
        `;

        // Via CSSOM, não innerHTML: a URL nunca é parseada como marcação (mesmo critério do detalhe do Archive).
        if (d.posterUrl) {
          (host.querySelector('.backdrop') as HTMLElement).style.backgroundImage = `url("${d.posterUrl}")`;
          (host.querySelector('.hero-poster') as HTMLElement).style.backgroundImage = `url("${d.posterUrl}")`;
        }

        (host.querySelector('#status-actions') as HTMLElement).appendChild(
          renderStatusActions({
            titleId: d.titleId,
            entryId: d.library?.id ?? null,
            watchStatus: d.library?.watch_status ?? null,
            rating: d.library?.rating ?? null,
            onChange: () => load(),
          }),
        );
      })
      .catch((err) => {
        host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>${escapeHtml(err instanceof Error ? err.message : 'não foi possível carregar este título')}</div>`;
      });
  };

  load();
};
