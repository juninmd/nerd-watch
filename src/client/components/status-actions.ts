import type { WatchStatus } from '../../server/types.ts';
import { patchLibrary, removeFromLibrary, type LibraryEntryDto } from '../api.ts';
import { showToast } from '../state.ts';

const STATUS_OPTIONS: Array<{ value: WatchStatus; label: string; icon: string }> = [
  { value: 'want', label: 'Quero ver', icon: '📌' },
  { value: 'watching', label: 'Assistindo', icon: '▶️' },
  { value: 'watched', label: 'Assistido', icon: '✅' },
  { value: 'dropped', label: 'Abandonei', icon: '⏹️' },
];

export interface StatusActionsOptions {
  titleId: string;
  entryId: string | null;
  watchStatus: WatchStatus | null;
  rating: number | null;
  onChange: (entry: LibraryEntryDto | null) => void;
}

export const renderStatusActions = (opts: StatusActionsOptions): HTMLElement => {
  const wrap = document.createElement('div');

  const statusRow = document.createElement('div');
  statusRow.className = 'status-select';
  for (const s of STATUS_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = `chip${opts.watchStatus === s.value ? ' active' : ''}`;
    btn.textContent = `${s.icon} ${s.label}`;
    btn.addEventListener('click', () => {
      patchLibrary(opts.titleId, { watchStatus: s.value })
        .then((item) => {
          showToast(`marcado como "${s.label.toLowerCase()}"`);
          opts.onChange({
            id: item.id,
            title_id: item.titleId,
            watch_status: item.watchStatus,
            rating: item.rating,
            notes: item.notes,
            current_season: item.currentSeason,
            current_episode: item.currentEpisode,
            added_at: item.addedAt,
            updated_at: item.updatedAt,
          });
        })
        .catch(() => showToast('não foi possível atualizar'));
    });
    statusRow.appendChild(btn);
  }
  wrap.appendChild(statusRow);

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
          .then((item) =>
            opts.onChange({
              id: item.id,
              title_id: item.titleId,
              watch_status: item.watchStatus,
              rating: item.rating,
              notes: item.notes,
              current_season: item.currentSeason,
              current_episode: item.currentEpisode,
              added_at: item.addedAt,
              updated_at: item.updatedAt,
            }),
          )
          .catch(() => showToast('não foi possível avaliar'));
      });
      ratingRow.appendChild(star);
    }
    wrap.appendChild(ratingRow);

    if (opts.entryId) {
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost btn-sm';
      remove.style.marginTop = '12px';
      remove.textContent = '🗑️ remover da lista';
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

  return wrap;
};
