import {
  getTmdbSeason,
  markProgressThrough,
  patchLibrary,
  removeFromLibrary,
  type LibraryEntryDto,
  type MarkThroughResult,
  type TmdbDetailDto,
} from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { icon } from '../icons.ts';
import { renderSpoilerText } from '../components/spoiler.ts';
import { isEpisodeWatched } from '../episode-progress.ts';
import { showToast } from '../state.ts';

const dateLabel = (iso: string | null): string => {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Desfaz a marcação com o estado que estava antes (ou tira a entrada, se a série não estava na lista). */
const undoMark = (titleId: string, result: MarkThroughResult, refresh: () => void): void => {
  const restore = result.previous
    ? patchLibrary(titleId, {
        watchStatus: result.previous.watchStatus,
        currentSeason: result.previous.currentSeason,
        currentEpisode: result.previous.currentEpisode,
      })
    : removeFromLibrary(result.item.id);
  restore
    .then(() => {
      showToast('progresso desfeito');
      refresh();
    })
    .catch(() => showToast('não foi possível desfazer'));
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
    <div class="section-head"><h2>Episódios</h2></div>
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
          listEl.innerHTML = `<div class="empty-state"><div class="big">${icon('film')}</div>sem episódios listados para esta temporada</div>`;
          return;
        }
        listEl.innerHTML = '';
        const marker = library?.current_season != null && library?.current_episode != null ? { season: library.current_season, episode: library.current_episode } : null;
        for (const ep of data.episodes) {
          const isCurrent = marker?.season === activeSeason && marker?.episode === ep.episodeNumber;
          const watched = !isCurrent && isEpisodeWatched(marker, activeSeason, ep.episodeNumber);
          const row = document.createElement('div');
          row.className = `episode-row${isCurrent ? ' current' : ''}${watched ? ' watched' : ''}`;
          row.innerHTML = `
            <div class="still"${ep.stillUrl ? ` style="background-image:url('${ep.stillUrl}')"` : ''}></div>
            <div class="body">
              <div class="head">
                <span class="name">${ep.episodeNumber}. ${escapeHtml(ep.name)}${watched ? ' <span class="seen">visto</span>' : ''}</span>
                <span class="date">${dateLabel(ep.airDate)}</span>
              </div>
              <div class="overview-slot"></div>
              <button class="btn btn-ghost btn-sm mark-current" style="margin-top:10px" type="button">
                ${isCurrent ? '✓ é onde você parou' : watched ? '↩ voltar o marcador para cá' : '📍 marcar até aqui'}
              </button>
            </div>
          `;
          row.querySelector('.overview-slot')?.appendChild(renderSpoilerText(ep.overview || 'Sem sinopse.', 'overview'));
          if (!isCurrent) {
            row.querySelector<HTMLButtonElement>('.mark-current')?.addEventListener('click', (e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              // Desabilitar durante o envio evita o duplo clique; o servidor também não regrava o mesmo marcador.
              btn.disabled = true;
              markProgressThrough(titleId, activeSeason, ep.episodeNumber)
                .then((res) => {
                  if (!res.changed) {
                    showToast('já estava marcado até aqui');
                    btn.disabled = false;
                    return;
                  }
                  showToast(`marcado até T${activeSeason} · Ep ${ep.episodeNumber}`, { label: 'Desfazer', run: () => undoMark(titleId, res, refreshParent) });
                  refreshParent();
                })
                .catch(() => {
                  btn.disabled = false;
                  showToast('não foi possível marcar');
                });
            });
          }
          listEl.appendChild(row);
        }
      })
      .catch(() => {
        if (requestedSeason !== activeSeason) return;
        listEl.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar os episódios</div>`;
      });
  };

  renderTabs();
  loadEpisodes();
};
