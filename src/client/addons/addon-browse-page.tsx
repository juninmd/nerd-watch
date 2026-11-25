import { Button, EmptyState, FilterChips, Hero, SearchField, Select, Skeleton } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import { type AddonDto, type AddonItemDto, getAddonCatalog, listAddons } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { PosterCard } from '../ui/poster-card.tsx';
import { addonItemPath } from './addon-links.ts';

const back = <BackButton label="addons" fallback="/addons" />;

/** Itens já carregados do catálogo; `more` = o addon pagina e a última página não veio vazia. */
type GridState = { items: AddonItemDto[]; more: boolean } | 'loading' | { error: string };

const useDebounced = (value: string, ms: number): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
};

function CatalogGrid({ addon, grid }: { addon: AddonDto; grid: GridState }) {
  if (grid === 'loading') return <Skeleton label="Carregando catálogo…" rows={6} media />;
  if ('error' in grid) {
    return (
      <div role="alert">
        <EmptyState icon={<Icon name="alert" />} title={grid.error} />
      </div>
    );
  }
  if (grid.items.length === 0) return <EmptyState icon={<Icon name="search" />} title="nada encontrado neste catálogo" />;
  return (
    <div className="grid">
      {grid.items.map((item) => (
        <PosterCard
          key={`${item.type}:${item.id}`}
          title={item.name}
          posterUrl={item.poster}
          meta={item.year ?? undefined}
          onClick={() => navigate(addonItemPath(addon.id, item.type, item.id))}
        />
      ))}
    </div>
  );
}

function AddonBrowser({ addon }: { addon: AddonDto }) {
  const [catalogIndex, setCatalogIndex] = useState(0);
  const [query, setQuery] = useState('');
  /** Gênero escolhido; `null` = todos. Sempre pertence ao catálogo atual. */
  const [genre, setGenre] = useState<string | null>(null);
  const [grid, setGrid] = useState<GridState>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);
  const search = useDebounced(query, 350);
  const cat = addon.catalogs[catalogIndex] ?? addon.catalogs[0];

  const load = (skip: number, prev: AddonItemDto[]) => {
    if (!cat) return;
    const mine = ++seq.current;
    if (skip === 0) setGrid('loading');
    setLoadingMore(skip > 0);
    getAddonCatalog(addon.id, cat.type, cat.id, {
      search: cat.searchable ? search.trim() : undefined,
      skip: skip || undefined,
      genre: genre ?? undefined,
    })
      .then((items) => {
        if (mine !== seq.current) return;
        setGrid({ items: [...prev, ...items], more: cat.paged && items.length > 0 });
      })
      .catch((error: Error) => {
        if (mine !== seq.current) return;
        // Falha ao paginar mantém o que já estava na tela; só a primeira página vira erro.
        setGrid(skip === 0 ? { error: error.message } : { items: prev, more: false });
      })
      .finally(() => {
        if (mine === seq.current) setLoadingMore(false);
      });
  };

  useEffect(() => {
    load(0, []);
    return () => {
      seq.current++;
    };
  }, [cat, genre, search]);

  const changeCatalog = (value: string) => {
    setQuery('');
    setGenre(null);
    setCatalogIndex(Number(value));
  };

  // Chips só com os gêneros que o próprio catálogo declara: gênero inventado voltaria vazio.
  const genres = cat?.genres ?? [];
  const items = typeof grid === 'object' && 'items' in grid ? grid : null;

  return (
    <>
      <Hero title={addon.name} meta={addon.host} backdrop={addon.background ?? undefined} />
      <div className="chip-row form-row">
        <Select
          label="catálogo"
          value={String(catalogIndex)}
          options={addon.catalogs.map((c, i) => ({ value: String(i), label: `${c.name} (${c.type})` }))}
          onChange={changeCatalog}
        />
        <SearchField
          className="grow"
          label="buscar neste catálogo"
          placeholder={cat?.searchable ? 'buscar neste catálogo' : 'este catálogo não aceita busca'}
          disabled={!cat?.searchable}
          autoComplete="off"
          value={query}
          onChange={setQuery}
        />
      </div>
      {genres.length > 0 && (
        <FilterChips
          label="filtrar por gênero"
          allLabel="todos"
          chips={genres.map((g) => ({ key: g, label: g }))}
          value={genre}
          onChange={setGenre}
        />
      )}
      <CatalogGrid addon={addon} grid={grid} />
      {items?.more && (
        <div className="chip-row">
          <Button variant="ghost" size="sm" loading={loadingMore} onClick={() => load(items.items.length, items.items)}>
            carregar mais
          </Button>
        </div>
      )}
    </>
  );
}

/** Catálogo de um addon instalado: escolhe o catálogo, busca (se o addon aceitar) e pagina com `skip`. */
export function AddonBrowsePage({ addonId }: { addonId: string }) {
  const [addon, setAddon] = useState<AddonDto | 'loading' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    listAddons()
      .then((addons) => {
        const found = addons.find((a) => a.id === addonId);
        if (alive) setAddon(found && found.catalogs.length > 0 ? found : 'error');
      })
      .catch(() => {
        if (alive) setAddon('error');
      });
    return () => {
      alive = false;
    };
  }, [addonId]);

  return (
    <div className="addon-browse">
      {back}
      {addon === 'loading' ? (
        <Skeleton label="Carregando addon…" rows={3} />
      ) : addon === 'error' ? (
        <div role="alert">
          <EmptyState icon={<Icon name="alert" />} title="addon não encontrado ou sem catálogo" />
        </div>
      ) : (
        <AddonBrowser addon={addon} />
      )}
    </div>
  );
}
