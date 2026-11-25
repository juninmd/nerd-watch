import { Artwork, Button, Dialog, EmptyState, Select } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { type LibraryItemDto, listLibrary } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { openOverlay } from '../ui/overlay.tsx';
import { libraryItemPath } from '../ui/title-link.ts';
import { filterPickCandidates, type PickFilters, type PickType, pickRandom } from './pick-random.ts';
import { useAlive } from './use-alive.ts';

const TYPE_OPTIONS: Array<{ value: PickType; label: string }> = [
  { value: 'all', label: 'filmes e séries' },
  { value: 'movie', label: 'só filmes' },
  { value: 'tv', label: 'só séries' },
];

const RATING_OPTIONS = [
  { value: '', label: 'qualquer' },
  ...[6, 7, 8, 9].map((n) => ({ value: String(n), label: `${n}+` })),
];

const NO_FILTERS: PickFilters = { type: 'all', minRating: null };

const metaLine = (item: LibraryItemDto): string =>
  [
    item.title.releaseDate?.slice(0, 4),
    item.title.mediaType === 'tv' ? 'série' : 'filme',
    item.title.voteAverage !== null ? `nota ${item.title.voteAverage.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

type Load = 'loading' | 'error' | LibraryItemDto[];

/**
 * "O que assistir hoje": sorteia um título da lista "quero ver" com filtros de tipo e nota mínima.
 * O resultado vai para uma região aria-live, e "Outro" nunca repete o sorteio anterior (com 2+ candidatos).
 */
function PickDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Load>('loading');
  const [filters, setFilters] = useState<PickFilters>(NO_FILTERS);
  const [current, setCurrent] = useState<LibraryItemDto | null>(null);
  const alive = useAlive();

  /** Sorteia de novo com os filtros dados; o anterior sai do sorteio quando há outros candidatos. */
  const pick = (list: LibraryItemDto[], f: PickFilters, avoid: LibraryItemDto | null) =>
    setCurrent(pickRandom(filterPickCandidates(list, f), { avoidId: avoid?.titleId ?? null }));

  useEffect(() => {
    listLibrary('want')
      .then((data) => {
        if (!alive.current) return;
        setItems(data.items);
        pick(data.items, NO_FILTERS, null);
      })
      .catch(() => {
        if (alive.current) setItems('error');
      });
  }, []);

  const changeFilters = (next: PickFilters) => {
    setFilters(next);
    if (Array.isArray(items)) pick(items, next, current);
  };

  const open = () => {
    if (!current) return;
    onClose();
    navigate(libraryItemPath(current));
  };

  const result = (() => {
    if (items === 'loading') return <EmptyState title="carregando sua lista…" />;
    if (items === 'error') return <EmptyState title="não foi possível carregar sua lista agora" />;
    if (items.length === 0) {
      const search = () => {
        onClose();
        navigate('/search');
      };
      return (
        <EmptyState
          title={'Sua lista "quero ver" está vazia.'}
          action={
            <Button size="sm" variant="secondary" onClick={search}>
              buscar títulos
            </Button>
          }
        />
      );
    }
    if (!current) {
      return (
        <EmptyState
          title="Nenhum título da sua lista passa nesses filtros."
          action={
            <Button size="sm" variant="secondary" onClick={() => changeFilters(NO_FILTERS)}>
              limpar filtros
            </Button>
          }
        />
      );
    }
    return (
      <div className="pick-card">
        <Artwork
          className="thumb"
          title={current.title.title}
          src={current.title.posterUrl ?? undefined}
          ratio="poster"
        />
        <div>
          <span className="pick-name">{current.title.title}</span>
          <span className="pick-meta">{metaLine(current)}</span>
        </div>
      </div>
    );
  })();

  return (
    <Dialog
      open
      onClose={onClose}
      title="O que assistir hoje"
      description={'Sorteio entre os títulos da sua lista "quero ver".'}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={!current}
            onClick={() => Array.isArray(items) && pick(items, filters, current)}
          >
            Outro
          </Button>
          <Button variant="primary" disabled={!current} onClick={open}>
            Abrir
          </Button>
        </>
      }
    >
      <div className="pick-filters">
        <Select
          label="Tipo"
          options={TYPE_OPTIONS}
          value={filters.type}
          onChange={(v) => changeFilters({ ...filters, type: v as PickType })}
        />
        <Select
          label="Nota mínima"
          options={RATING_OPTIONS}
          value={filters.minRating === null ? '' : String(filters.minRating)}
          onChange={(v) => changeFilters({ ...filters, minRating: v ? Number(v) : null })}
        />
      </div>
      <div className="pick-result" aria-live="polite">
        {result}
      </div>
    </Dialog>
  );
}

let isOpen = false;

/** Abre o sorteio de qualquer tela (biblioteca, início, paleta). Já aberto, não abre outro. */
export const openPickDialog = (): void => {
  if (isOpen) return;
  isOpen = true;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  openOverlay((close) => (
    <PickDialog
      onClose={() => {
        close();
        isOpen = false;
        if (opener?.isConnected) opener.focus();
      }}
    />
  ));
};
