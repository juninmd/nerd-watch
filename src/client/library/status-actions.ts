import type { WatchStatus } from '../../server/types.ts';
import { patchLibrary, removeFromLibrary, rewatchLibrary, type LibraryEntryDto, type LibraryItemDto } from '../api/index.ts';
import { burst } from '../ui/effects.ts';
import { type IconName, icon } from '../ui/icons.ts';
import { showToast } from '../app/state.ts';
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
  let busy = false;

  const statusRow = document.createElement('div');
  statusRow.className = 'status-select';
  for (const s of STATUS_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${opts.watchStatus === s.value ? ' active' : ''}`;
    btn.setAttribute('aria-pressed', String(opts.watchStatus === s.value));
    btn.innerHTML = `${icon(s.icon, 'sm')} ${s.label}`;
    btn.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      btn.disabled = true;
      patchLibrary(opts.titleId, { watchStatus: s.value })
        .then((item) => {
          showToast(`marcado como "${s.label.toLowerCase()}"`);
          if (!wrap.isConnected) return;
          if (s.value === 'watched') burst(btn);
          opts.onChange(toEntryDto(item));
        })
        .catch(() => {
          busy = false;
          btn.disabled = false;
          showToast('não foi possível atualizar');
        });
    });
    statusRow.appendChild(btn);
  }
  wrap.appendChild(statusRow);

  if (opts.watchStatus === 'watched' || opts.rewatchCount > 0) {
    const rewatchRow = document.createElement('div');
    rewatchRow.className = 'rewatch-row';
    if (opts.watchStatus === 'watched') {
      const rewatch = document.createElement('button');
      rewatch.type = 'button';
      rewatch.className = 'btn btn-ghost btn-sm';
      rewatch.innerHTML = `${icon('replay', 'sm')} Rever`;
      rewatch.addEventListener('click', () => {
        if (busy) return;
        // Desabilita durante o pedido: um segundo clique receberia 409 e enganaria o usuário.
        busy = true;
        rewatch.disabled = true;
        rewatchLibrary(opts.titleId)
          .then((item) => {
            showToast('revisão iniciada');
            if (!wrap.isConnected) return;
            opts.onChange(toEntryDto(item));
          })
          .catch(() => {
            busy = false;
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
      const value = (i + 1) * 2;
      const star = document.createElement('button');
      star.type = 'button';
      star.className = `star${i < filled ? ' filled' : ''}`;
      star.textContent = '★';
      star.setAttribute('aria-label', value === opts.rating ? `Remover nota de ${i + 1} estrelas` : `Avaliar com ${i + 1} ${i === 0 ? 'estrela' : 'estrelas'}`);
      star.setAttribute('aria-pressed', String(value === opts.rating));
      star.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        patchLibrary(opts.titleId, { rating: value === opts.rating ? null : value })
          .then((item) => {
            if (!wrap.isConnected) return;
            opts.onChange(toEntryDto(item));
          })
          .catch(() => {
            busy = false;
            showToast('não foi possível avaliar');
          });
      });
      ratingRow.appendChild(star);
    }
    wrap.appendChild(ratingRow);

    if (opts.entryId) {
      const entryId = opts.entryId;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm';
      remove.style.marginTop = '12px';
      remove.innerHTML = `${icon('trash', 'sm')} remover da lista`;
      remove.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        remove.disabled = true;
        removeFromLibrary(entryId)
          .then(() => {
            showToast('removido da lista');
            if (!wrap.isConnected) return;
            opts.onChange(null);
          })
          .catch(() => {
            busy = false;
            remove.disabled = false;
            showToast('não foi possível remover');
          });
      });
      wrap.appendChild(remove);
    }
  }

  if (opts.entryId) wrap.appendChild(renderLibraryHistory(opts.titleId));

  return wrap;
};
