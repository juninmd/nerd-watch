import { Button, FilterChips, Rating } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import type { WatchStatus } from '../../server/types.ts';
import {
  type LibraryEntryDto,
  type LibraryItemDto,
  patchLibrary,
  removeFromLibrary,
  rewatchLibrary,
} from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { burst } from '@juninmd/sonido';
import { Icon } from '../ui/icon.tsx';
import { LibraryHistory } from './library-history.tsx';
import { useAlive } from './use-alive.ts';

const STATUS_OPTIONS: Array<{ key: WatchStatus; label: string }> = [
  { key: 'want', label: 'Quero ver' },
  { key: 'watching', label: 'Assistindo' },
  { key: 'watched', label: 'Assistido' },
  { key: 'dropped', label: 'Abandonei' },
];

export interface StatusActionsProps {
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

/** Status, revisão, nota e remoção de um título da biblioteca, mais o histórico. Uma ação por vez. */
export function StatusActions({ titleId, entryId, watchStatus, rating, rewatchCount, onChange }: StatusActionsProps) {
  const [busy, setBusy] = useState<'status' | 'rewatch' | 'rating' | 'remove' | null>(null);
  const alive = useAlive();
  // Props novas = a tela recarregou a entrada: a ação anterior terminou.
  useEffect(() => setBusy(null), [entryId, watchStatus, rating, rewatchCount]);

  const run = (
    kind: NonNullable<typeof busy>,
    request: () => Promise<LibraryEntryDto | null>,
    failure: string,
    done?: () => void,
  ) => {
    if (busy) return;
    setBusy(kind);
    request()
      .then((entry) => {
        done?.();
        if (alive.current) onChange(entry);
      })
      .catch(() => {
        if (alive.current) setBusy(null);
        showToast(failure);
      });
  };

  const setStatus = (value: WatchStatus | null) => {
    // Clicar no status ativo não desmarca: remover é a ação explícita mais abaixo.
    const option = STATUS_OPTIONS.find((s) => s.key === (value ?? watchStatus));
    if (!option) return;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    run(
      'status',
      () => patchLibrary(titleId, { watchStatus: option.key }).then(toEntryDto),
      'não foi possível atualizar',
      () => {
        showToast(`marcado como "${option.label.toLowerCase()}"`);
        if (option.key === 'watched' && from?.isConnected) burst(from);
      },
    );
  };

  const rate = (stars: number) => {
    const value = stars * 2;
    run(
      'rating',
      () => patchLibrary(titleId, { rating: value === rating ? null : value }).then(toEntryDto),
      'não foi possível avaliar',
    );
  };

  return (
    <div aria-busy={busy !== null}>
      <div className="status-select">
        <FilterChips label="Status na biblioteca" chips={STATUS_OPTIONS} value={watchStatus} onChange={setStatus} />
      </div>
      {(watchStatus === 'watched' || rewatchCount > 0) && (
        <div className="rewatch-row">
          {watchStatus === 'watched' && (
            <Button
              variant="ghost"
              size="sm"
              iconStart={<Icon name="replay" size="sm" />}
              // Desabilita durante o pedido: um segundo clique receberia 409 e enganaria o usuário.
              loading={busy === 'rewatch'}
              onClick={() =>
                run(
                  'rewatch',
                  () => rewatchLibrary(titleId).then(toEntryDto),
                  'não foi possível rever',
                  () => showToast('revisão iniciada'),
                )
              }
            >
              Rever
            </Button>
          )}
          {rewatchCount > 0 && (
            <span className="rewatch-count">
              {/* rewatch_count conta as revisões; a primeira exibição conta como uma a mais. */}
              <Icon name="eye" size="sm" /> Visto {rewatchCount + 1} vezes
            </span>
          )}
        </div>
      )}
      {watchStatus && (
        <>
          <div className="rating-row">
            {/* Clicar na nota atual remove a nota. */}
            <Rating
              label="Sua nota (clique na atual para remover)"
              value={Math.round((rating ?? 0) / 2)}
              onChange={rate}
            />
          </div>
          {entryId && (
            <Button
              variant="ghost"
              size="sm"
              iconStart={<Icon name="trash" size="sm" />}
              loading={busy === 'remove'}
              onClick={() =>
                run(
                  'remove',
                  () => removeFromLibrary(entryId).then(() => null),
                  'não foi possível remover',
                  () => showToast('removido da lista'),
                )
              }
            >
              remover da lista
            </Button>
          )}
        </>
      )}
      {entryId && <LibraryHistory titleId={titleId} />}
    </div>
  );
}
