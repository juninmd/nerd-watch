import { Button, Carousel, EmptyState, PageHeader, Skeleton } from '@juninmd/sonido';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type AddonBoardDto, type AddonItemDto, getAddonCatalog, listBoards } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { PosterCard } from '../ui/poster-card.tsx';
import { addonItemPath, addonPath } from './addon-links.ts';
import { openCatalogManager } from './catalog-manager.tsx';
import { type CatalogPrefs, mergeFeed, readCatalogPrefs, saveCatalogPrefs, visibleBoards } from './catalog-prefs.ts';
import { groupBoards, MAX_RAILS, RAIL_ITEMS, railsOf } from './discover-model.ts';

type LoadBoard = (board: AddonBoardDto) => Promise<AddonItemDto[]>;

/** Um pedido por catálogo na tela: o trilho e o "Meu feed" dividem a mesma resposta. */
const boardLoader = (): LoadBoard => {
  const cache = new Map<string, Promise<AddonItemDto[]>>();
  return (b) => {
    let p = cache.get(b.key);
    if (!p) {
      p = getAddonCatalog(b.addonId, b.type, b.catalogId);
      cache.set(b.key, p);
    }
    return p;
  };
};

const itemCard = (addonId: string, item: AddonItemDto) => (
  <PosterCard
    key={`${item.type}:${item.id}`}
    title={item.name}
    posterUrl={item.poster}
    meta={item.year ?? undefined}
    onClick={() => navigate(addonItemPath(addonId, item.type, item.id))}
  />
);

/** "Meu feed": intercala os trilhos visíveis; catálogo que falha só fica de fora. */
function FeedRail({ boards, load }: { boards: AddonBoardDto[]; load: LoadBoard }) {
  const [items, setItems] = useState<{ addonId: string; item: AddonItemDto }[] | null>(null);
  const keys = boards.map((b) => b.key).join('|');
  useEffect(() => {
    let alive = true;
    setItems(null);
    Promise.all(boards.map((b) => load(b).then((list) => list.map((item) => ({ addonId: b.addonId, item }))).catch(() => [])))
      .then((lists) => {
        if (!alive) return;
        const merged = mergeFeed(lists.map((l) => l.map((x) => x.item)));
        const owner = new Map(lists.flat().map((x) => [`${x.item.type}:${x.item.id}`, x.addonId]));
        setItems(merged.map((item) => ({ item, addonId: owner.get(`${item.type}:${item.id}`) ?? '' })));
      });
    return () => {
      alive = false;
    };
  }, [keys]);
  return (
    <Carousel title="Meu feed" itemWidth={168}>
      {items === null ? (
        <Skeleton label="Montando seu feed…" rows={2} media />
      ) : items.length === 0 ? (
        <EmptyState title="nada nos catálogos visíveis agora" />
      ) : (
        items.map((x) => itemCard(x.addonId, x.item))
      )}
    </Carousel>
  );
}

type RailState = AddonItemDto[] | 'loading' | { error: string };

/** Um trilho por catálogo; cada um busca sozinho, então um addon lento ou fora do ar só afeta o próprio trilho. */
function DiscoverRail({ board, load }: { board: AddonBoardDto; load: LoadBoard }) {
  const [state, setState] = useState<RailState>('loading');
  useEffect(() => {
    let alive = true;
    load(board)
      .then((items) => {
        if (alive) setState(items);
      })
      .catch((error: unknown) => {
        if (alive) setState({ error: error instanceof Error ? error.message : 'o addon não respondeu' });
      });
    return () => {
      alive = false;
    };
  }, [board.key]);

  let body: ReactNode;
  if (state === 'loading') body = <Skeleton label={`Carregando ${board.name}…`} rows={2} media />;
  else if ('error' in state) body = <EmptyState icon={<Icon name="alert" />} title={state.error} />;
  else if (state.length === 0) body = <EmptyState title="este catálogo está vazio agora" />;
  else body = state.slice(0, RAIL_ITEMS).map((item) => itemCard(board.addonId, item));

  return (
    <Carousel title={`${board.addonName} · ${board.name}`} itemWidth={168} action={<a href={`#${addonPath(board.addonId)}`}>ver tudo</a>}>
      {body}
    </Carousel>
  );
}

type PageState = AddonBoardDto[] | 'loading' | 'error';

/**
 * Tela Descobrir: um trilho por catálogo dos addons instalados. O catálogo é de terceiros e cada
 * trilho é uma requisição externa, então a tela limita quantidade e itens e preenche em paralelo.
 */
export function DiscoverPage() {
  const [boards, setBoards] = useState<PageState>('loading');
  const [prefs, setPrefs] = useState(readCatalogPrefs);
  const load = useMemo(boardLoader, []);
  const changePrefs = (p: CatalogPrefs) => {
    setPrefs(p);
    saveCatalogPrefs(p);
  };
  useEffect(() => {
    let alive = true;
    listBoards()
      .then((b) => {
        if (alive) setBoards(b);
      })
      .catch(() => {
        if (alive) setBoards('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const back = <BackButton fallback="/addons" />;
  if (boards === 'loading') {
    return (
      <>
        {back}
        <Skeleton label="Carregando catálogos…" rows={4} />
      </>
    );
  }
  if (boards === 'error') {
    return (
      <>
        {back}
        <EmptyState icon={<Icon name="alert" />} title="não foi possível listar os catálogos dos addons" />
      </>
    );
  }
  const groups = groupBoards(boards);
  // Ordem padrão (filmes e séries primeiro) é a base; a escolha do usuário reordena e esconde por cima.
  const all = railsOf(groups, boards.length);
  const rails = visibleBoards(all, prefs).slice(0, MAX_RAILS);
  if (all.length === 0) {
    return (
      <>
        <PageHeader titleAs="h1" title="Descobrir nos addons" leading={back} />
        <EmptyState
          icon={<Icon name="puzzle" />}
          title="nenhum addon instalado publica catálogo"
          description="os que só entregam streams aparecem na página do título."
          action={
            <Button size="sm" href="#/addons">
              gerenciar addons
            </Button>
          }
        />
      </>
    );
  }
  return (
    <>
      <PageHeader titleAs="h1"
        title="Descobrir nos addons"
        leading={back}
        description={`${rails.length} catálogo(s) de ${groups.length} addon(s). O conteúdo é de quem publica cada addon.`}
        actions={
          <Button size="sm" variant="ghost" iconStart={<Icon name="sliders" size="sm" />} onClick={() => openCatalogManager({ boards: all, prefs, onChange: changePrefs })}>
            gerenciar catálogos
          </Button>
        }
      />
      {prefs.feed && rails.length > 0 && <FeedRail boards={rails} load={load} />}
      {rails.length === 0 && <EmptyState title="todos os catálogos estão ocultos" description="use “gerenciar catálogos” para mostrar de novo." />}
      {rails.map((board) => (
        <DiscoverRail key={board.key} board={board} load={load} />
      ))}
    </>
  );
}
