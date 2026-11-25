import { Button, EmptyState, FilterChips, SearchField, Select, Skeleton } from '@juninmd/sonido';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedViewSort } from '../../server/saved-views/schema.ts';
import type { WatchStatus } from '../../server/types.ts';
import { bulkLibrary, type LibraryItemDto, listLibrary } from '../api/index.ts';
import { listSavedViews, type SavedViewDto } from '../api/saved-views.ts';
import { invalidatePaletteData } from '../app/command-palette.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { LibraryBulkBar } from './library-bulk-bar.tsx';
import {
  applyLibraryQuery,
  countByStatus,
  filterByName,
  filterBySource,
  type SourceFilter,
  type StatusFilter,
} from './library-filter.ts';
import { type Layout, LibraryGrid, loadLayout, saveLayout } from './library-grid.tsx';
import { openPickDialog } from './pick-dialog.tsx';
import { SavedViewsBar } from './saved-views-bar.tsx';
import { useAlive } from './use-alive.ts';

const STATUS_CHIPS: Array<{ key: WatchStatus; label: string }> = [
  { key: 'watching', label: 'Assistindo' },
  { key: 'want', label: 'Quero ver' },
  { key: 'watched', label: 'Assistido' },
  { key: 'dropped', label: 'Abandonado' },
];

const SOURCES: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'todas as origens' },
  { value: 'tmdb', label: 'filmes e séries' },
  { value: 'archive', label: 'domínio público' },
  { value: 'tvmaze', label: 'TVmaze' },
  { value: 'anilist', label: 'AniList' },
  { value: 'telegram', label: 'Telegram' },
];

const SORTS: Array<{ value: SavedViewSort; label: string }> = [
  { value: 'recent', label: 'mais recentes' },
  { value: 'title', label: 'título A–Z' },
  { value: 'rating', label: 'maior nota' },
];

/** Biblioteca: tudo que o usuário marcou, com abas por status, filtro de origem, grade/lista e ações em lote. */
export function LibraryPage({ query }: { query: URLSearchParams }) {
  const [items, setItems] = useState<LibraryItemDto[] | 'loading' | 'error'>('loading');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [sort, setSort] = useState<SavedViewSort>('recent');
  const [nameQuery, setNameQuery] = useState('');
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [views, setViews] = useState<SavedViewDto[]>([]);
  const [busy, setBusy] = useState(false);
  const alive = useAlive();
  const loadSeq = useRef(0);

  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const named = useMemo(() => filterByName(list, nameQuery), [list, nameQuery]);
  const shown = useMemo(() => applyLibraryQuery(named, { status, source, sort }), [named, status, source, sort]);
  const counts = useMemo(() => countByStatus(filterBySource(named, source)), [named, source]);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    listLibrary()
      .then((data) => {
        if (seq !== loadSeq.current || !alive.current) return;
        setItems(data.items);
        const present = new Set(data.items.map((i) => i.titleId));
        setPicked((prev) => new Set([...prev].filter((id) => present.has(id))));
      })
      .catch(() => {
        if (seq === loadSeq.current && alive.current) setItems('error');
      });
  }, [alive]);

  const refreshViews = useCallback(
    () =>
      listSavedViews()
        .then((data) => {
          invalidatePaletteData();
          if (alive.current) setViews(data.items);
          return data.items;
        })
        .catch(() => {
          showToast('não foi possível carregar as visões salvas');
          return [] as SavedViewDto[];
        }),
    [alive],
  );

  /** Trocar filtro muda o que é "todos"; manter a seleção de itens fora da vista deixaria o lote agir no escuro. */
  const resetSelection = () => setPicked(new Set());

  /** Uma visão salva: aplica filtro, origem, ordem e layout de uma vez. */
  const applyView = useCallback((view: Pick<SavedViewDto, 'query'>) => {
    setStatus(view.query.status);
    setSource(view.query.source);
    setSort(view.query.sort);
    setLayout(view.query.layout);
    saveLayout(view.query.layout);
    setPicked(new Set());
  }, []);

  useEffect(() => {
    load();
    // Link "abrir visão" (paleta Ctrl K): aplica a visão assim que as visões carregarem.
    void refreshViews().then((loaded) => {
      const view = loaded.find((v) => v.id === query.get('view'));
      if (view && alive.current) applyView(view);
    });
  }, []);

  // Sem nada visível não há o que selecionar: sai do modo lote em vez de ficar em "0 de 0 selecionados".
  useEffect(() => {
    if (Array.isArray(items) && shown.length === 0 && selecting) {
      setSelecting(false);
      setPicked(new Set());
    }
  }, [items, shown.length, selecting]);

  const toggle = useCallback(
    (id: string) =>
      setPicked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  const apply = (input: Parameters<typeof bulkLibrary>[0], doneMessage: (n: number) => string) => {
    setBusy(true);
    bulkLibrary(input)
      .then((res) => {
        showToast(doneMessage(res.affected));
        if (!alive.current) return;
        setPicked(new Set());
        setSelecting(false);
        load();
      })
      .catch((err) => showToast(err instanceof Error ? err.message : 'falha ao aplicar a ação'))
      .finally(() => alive.current && setBusy(false));
  };

  const clearFilters = () => {
    setStatus('all');
    setSource('all');
    setNameQuery('');
    resetSelection();
  };

  const body = (() => {
    if (items === 'loading') return <Skeleton label="Carregando biblioteca…" rows={6} media />;
    if (items === 'error')
      return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar sua biblioteca" />;
    if (shown.length === 0) {
      return items.length === 0 ? (
        <EmptyState
          icon={<Icon name="inbox" />}
          title="sua biblioteca está vazia"
          description={
            <>
              <a href="#/search">busque algo</a> para adicionar
            </>
          }
        />
      ) : (
        <EmptyState
          icon={<Icon name="inbox" />}
          title="nada neste filtro"
          action={
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              limpar filtros
            </Button>
          }
        />
      );
    }
    return <LibraryGrid items={shown} layout={layout} selecting={selecting} picked={picked} onToggle={toggle} />;
  })();

  return (
    <>
      <header className="view-head">
        <h1 className="view-title">Biblioteca</h1>
        <p className="view-subtitle">Tudo o que você marcou, de "quero ver" a "abandonado".</p>
      </header>
      <SavedViewsBar
        views={views}
        current={{ status, source, layout, sort }}
        onApply={applyView}
        onRefresh={refreshViews}
      />
      <div className="toolbar">
        <FilterChips
          label="Filtrar por status"
          chips={STATUS_CHIPS.map((c) => ({ ...c, count: counts[c.key] }))}
          value={status === 'all' ? null : status}
          onChange={(v) => {
            setStatus(v ?? 'all');
            resetSelection();
          }}
          allLabel="Tudo"
          allCount={counts.all}
        />
        <SearchField
          label="Filtrar por nome"
          placeholder="Filtrar por nome"
          value={nameQuery}
          onChange={(v) => {
            setNameQuery(v);
            resetSelection();
          }}
        />
        <Select
          label="Origem"
          options={SOURCES}
          value={source}
          onChange={(v) => {
            setSource(v as SourceFilter);
            resetSelection();
          }}
        />
        <Select label="Ordenar por" options={SORTS} value={sort} onChange={(v) => setSort(v as SavedViewSort)} />
        <span className="toolbar-spacer" />
        <a href="#/lists">Listas</a>
        <Button variant="ghost" size="sm" iconStart={<Icon name="dice" size="sm" />} onClick={openPickDialog}>
          o que assistir hoje
        </Button>
        {/* Rótulo fixo + aria-pressed: o estado é lido pelo leitor de tela, não pelo texto do botão. */}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={layout === 'list'}
          iconStart={<Icon name="list" size="sm" />}
          onClick={() => {
            const next = layout === 'grid' ? 'list' : 'grid';
            setLayout(next);
            saveLayout(next);
          }}
        >
          lista
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={selecting}
          iconStart={<Icon name={selecting ? 'x' : 'select'} size="sm" />}
          onClick={() => {
            setSelecting(!selecting);
            resetSelection();
          }}
        >
          {selecting ? 'cancelar seleção' : 'selecionar'}
        </Button>
      </div>
      {selecting && (
        <LibraryBulkBar
          picked={[...picked]}
          shown={shown.length}
          busy={busy}
          onToggleAll={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((i) => i.titleId)))}
          onStatus={(watchStatus) =>
            apply({ titleIds: [...picked], action: 'status', watchStatus }, (n) => `${n} item(ns) atualizado(s)`)
          }
          onRemove={() => {
            if (
              !confirm(
                `Remover ${picked.size} item(ns) da biblioteca? Notas e status somem; o título continua disponível na busca.`,
              )
            )
              return;
            apply({ titleIds: [...picked], action: 'remove' }, (n) => `${n} item(ns) removido(s)`);
          }}
        />
      )}
      <div id="lib-list">{body}</div>
    </>
  );
}
