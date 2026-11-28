import { memo } from 'react';
import type { LibraryItemDto } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { PosterCard } from '../ui/poster-card.tsx';
import { libraryItemPath } from '../ui/title-link.ts';

const LAYOUT_KEY = 'nw.library.layout';
export type Layout = 'grid' | 'list';

export const loadLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

export const saveLayout = (layout: Layout): void => {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // preferência só de conveniência
  }
};

const metaFor = (item: LibraryItemDto): string | undefined =>
  item.currentSeason && item.title.mediaType === 'tv'
    ? `T${item.currentSeason} · Ep ${item.currentEpisode}`
    : (item.title.releaseDate?.slice(0, 4) ?? undefined);

/** Memo: marcar um card não redesenha a grade inteira (biblioteca grande custava caro a cada clique). */
const LibraryCard = memo(function LibraryCard({
  item,
  selecting,
  selected,
  onToggle,
}: {
  item: LibraryItemDto;
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <PosterCard
      title={item.title.title}
      posterUrl={item.title.posterUrl}
      meta={metaFor(item)}
      status={item.watchStatus}
      score={item.title.voteAverage}
      selection={selecting ? { selected, onToggle: () => onToggle(item.titleId) } : undefined}
      onClick={() => navigate(libraryItemPath(item))}
    />
  );
});

export interface LibraryGridProps {
  items: LibraryItemDto[];
  layout: Layout;
  selecting: boolean;
  picked: ReadonlySet<string>;
  /** Estável (useCallback): é o que deixa o memo dos cards funcionar. */
  onToggle: (id: string) => void;
}

export function LibraryGrid({ items, layout, selecting, picked, onToggle }: LibraryGridProps) {
  return (
    <div className={layout === 'list' ? 'grid as-list' : 'grid'}>
      {items.map((item) => (
        <LibraryCard
          key={item.titleId}
          item={item}
          selecting={selecting}
          selected={picked.has(item.titleId)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
