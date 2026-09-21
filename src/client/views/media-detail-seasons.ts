import { getTmdbSeason, patchLibrary, type LibraryEntryDto, type TmdbDetailDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { renderSpoilerText } from '../components/spoiler.ts';
import { showToast } from '../state.ts';

const dateLabel = (iso: string | null): string => {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const renderSeasons = (
  container: HTMLElement,
  tmdbId: string,
  seasons: TmdbDetailDto['seasons'],
  titleId: string,
  library: LibraryEntryDto | null,
  refreshParent: () => void,
): void => {
  const real = seasons.filter((s) => s.episodeCount > 0);
  if (real.length === 0) {
    container.innerHTML = '';
    return;
  }

  let activeSeason = library?.current_season && real.some((s) => s.seasonNumber === library.current_season) ? library.current_season : real[0]?.seasonNumber ?? 1;

  container.innerHTML = `
    <div class="section-head"><h2>📺 Episódios</h2></div>
    <div class="season-tabs" id="season-tabs"></div>
    <div id="episode-list"></div>
  `;

  const tabsEl = container.querySelector('#season-tabs') as HTMLElement;
  const listEl = container.querySelector('#episode-list') as HTMLElement;

  const renderTabs = () => {
    tabsEl.innerHTML = real
      .map((s) => `<button class="chip${s.seasonNumber === activeSeason ? ' active' : ''}" data-season="${s.seasonNumber}">${escapeHtml(s.name)}</button>`)
      .join('');
    tabsEl.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeSeason = Number(btn.dataset.season);
        renderTabs();
        loadEpisodes();
      });
    });
  };

  const loadEpisodes = () => {
    listEl.innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton" style="height:96px;margin-bottom:10px"></div>').join('');
    const requestedSeason = activeSeason;
    getTmdbSeason(tmdbId, requestedSeason)
      .then((data) => {
        if (requestedSeason !== activeSeason) return;
        if (data.episodes.length === 0) {
          listEl.innerHTML = `<div class="empty-state"><div class="big">🎬</div>sem episódios listados para esta temporada</div>`;
          return;
        }
        listEl.innerHTML = '';
        for (const ep of data.episodes) {
          const isCurrent = library?.current_season === activeSeason && library?.current_episode === ep.episodeNumber;
          const row = document.createElement('div');
          row.className = `episode-row${isCurrent ? ' current' : ''}`;
          row.innerHTML = `
            <div class="still"${ep.stillUrl ? ` style="background-image:url('${ep.stillUrl}')"` : ''}></div>
            <div class="body">
              <div class="head">
                <span class="name">${ep.episodeNumber}. ${escapeHtml(ep.name)}</span>
                <span class="date">${dateLabel(ep.airDate)}</span>
              </div>
              <div class="overview-slot"></div>
              <button class="btn btn-ghost btn-sm mark-current" style="margin-top:10px">
                ${isCurrent ? '✓ é onde você parou' : '📍 marcar como onde parei'}
              </button>
            </div>
          `;
          row.querySelector('.overview-slot')?.appendChild(renderSpoilerText(ep.overview || 'Sem sinopse.', 'overview'));
          if (!isCurrent) {
            row.querySelector('.mark-current')?.addEventListener('click', () => {
              patchLibrary(titleId, { watchStatus: library?.watch_status ?? 'watching', currentSeason: activeSeason, currentEpisode: ep.episodeNumber })
                .then(() => {
                  showToast(`marcado: T${activeSeason} · Ep ${ep.episodeNumber}`);
                  refreshParent();
                })
                .catch(() => showToast('não foi possível marcar'));
            });
          }
          listEl.appendChild(row);
        }
      })
      .catch(() => {
        if (requestedSeason !== activeSeason) return;
        listEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar os episódios</div>`;
      });
  };

  renderTabs();
  loadEpisodes();
};
