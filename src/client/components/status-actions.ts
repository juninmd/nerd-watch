import type { WatchStatus } from '../../server/types.ts';
import { patchLibrary, removeFromLibrary, rewatchLibrary, type LibraryEntryDto, type LibraryItemDto } from '../api.ts';
import { type IconName, icon } from '../icons.ts';
import { showToast } from '../state.ts';
import { renderLibraryHistory } from './library-history.ts';

const STATUS_OPTIONS: Array<{ value: WatchStatus; label: string; icon: IconName }> = [
  { value: 'want', label: 'Quero ver', icon: 'bookmark' },
  { value: 'watching', label: 'Assistindo', icon: 'play' },
  { value: 'watched', label: 'Assistido', icon: 'check' },
  { value: 'dropped', label: 'Abandonei', icon: 'stop' },
];

export interface StatusActionsOptions {
  titleId: string;
  entryId: string | null;
  watchStatus: WatchStatus | null;
  rating: number | null;
  rewatchCount: number;
  onChange: (entry: LibraryEntryDto | null) => void;
}

const toEntryDto = (item: LibraryItemDto): LibraryEntryDto => ({
  id: item.id,
  title_id: item.titleId,
  watch_status: item.watchStatus,
  rating: item.rating,
  notes: item.notes,
  current_season: item.currentSeason,
  current_episode: item.currentEpisode,
  rewatch_count: item.rewatchCount,
  added_at: item.addedAt,
  updated_at: item.updatedAt,
});

export const renderStatusActions = (opts: StatusActionsOptions): HTMLElement => {
  const wrap = document.createElement('div');

  const statusRow = document.createElement('div');
  statusRow.className = 'status-select';
  for (const s of STATUS_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = `chip${opts.watchStatus === s.value ? ' active' : ''}`;
    btn.setAttribute('aria-pressed', String(opts.watchStatus === s.value));
    btn.innerHTML = `${icon(s.icon, 'sm')} ${s.label}`;
    btn.addEventListener('click', () => {
      patchLibrary(opts.titleId, { watchStatus: s.value })
        .then((item) => {
          showToast(`marcado como "${s.label.toLowerCase()}"`);
          opts.onChange(toEntryDto(item));
        })
        .catch(() => showToast('não foi possível atualizar'));
    });
    statusRow.appendChild(btn);
  }
  wrap.appendChild(statusRow);

  if (opts.watchStatus === 'watched' || opts.rewatchCount > 0) {
    const rewatchRow = document.createElement('div');
    rewatchRow.className = 'rewatch-row';
    if (opts.watchStatus === 'watched') {
      const rewatch = document.createElement('button');
      rewatch.className = 'btn btn-ghost btn-sm';
      rewatch.innerHTML = `${icon('replay', 'sm')} Rever`;
      rewatch.addEventListener('click', () => {
        // Desabilita durante o pedido: um segundo clique receberia 409 e enganaria o usuário.
        rewatch.disabled = true;
        rewatchLibrary(opts.titleId)
          .then((item) => {
            showToast('revisão iniciada');
            opts.onChange(toEntryDto(item));
          })
          .catch(() => {
            rewatch.disabled = false;
            showToast('não foi possível rever');
          });
      });
      rewatchRow.appendChild(rewatch);
    }
    if (opts.rewatchCount > 0) {
      const count = document.createElement('span');
      count.className = 'rewatch-count';
      // rewatch_count conta as revisões; a primeira exibição conta como uma a mais.
      count.innerHTML = `${icon('eye', 'sm')} Visto ${opts.rewatchCount + 1} vezes`;
      rewatchRow.appendChild(count);
    }
    wrap.appendChild(rewatchRow);
  }

  if (opts.watchStatus) {
    const ratingRow = document.createElement('div');
    ratingRow.className = 'rating-row';
    ratingRow.style.marginTop = '10px';
    const filled = Math.round((opts.rating ?? 0) / 2);
    for (let i = 0; i < 5; i++) {
      const star = document.createElement('span');
      star.className = `star${i < filled ? ' filled' : ''}`;
      star.textContent = '★';
      star.addEventListener('click', () => {
        const value = (i + 1) * 2;
        patchLibrary(opts.titleId, { rating: value === opts.rating ? null : value })
          .then((item) => opts.onChange(toEntryDto(item)))
          .catch(() => showToast('não foi possível avaliar'));
      });
      ratingRow.appendChild(star);
    }
    wrap.appendChild(ratingRow);

    if (opts.entryId) {
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost btn-sm';
      remove.style.marginTop = '12px';
      remove.innerHTML = `${icon('trash', 'sm')} remover da lista`;
      remove.addEventListener('click', () => {
        // biome-ignore lint/style/noNonNullAssertion: guardado pelo if acima
        removeFromLibrary(opts.entryId!)
          .then(() => {
            showToast('removido da lista');
            opts.onChange(null);
          })
          .catch(() => showToast('não foi possível remover'));
      });
      wrap.appendChild(remove);
    }
  }

  if (opts.entryId) wrap.appendChild(renderLibraryHistory(opts.titleId));

  return wrap;
};
