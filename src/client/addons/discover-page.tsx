import { Button, Carousel, EmptyState, PageHeader, Skeleton } from '@juninmd/sonido';
import { type ReactNode, useEffect, useState } from 'react';
import { type AddonBoardDto, type AddonItemDto, getAddonCatalog, listBoards } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { PosterCard } from '../ui/poster-card.tsx';
import { addonItemPath, addonPath } from './addon-links.ts';
import { groupBoards, RAIL_ITEMS, railsOf } from './discover-model.ts';

type RailState = AddonItemDto[] | 'loading' | { error: string };

/** Um trilho por catálogo; cada um busca sozinho, então um addon lento ou fora do ar só afeta o próprio trilho. */
function DiscoverRail({ board }: { board: AddonBoardDto }) {
  const [state, setState] = useState<RailState>('loading');
  useEffect(() => {
    let alive = true;
    getAddonCatalog(board.addonId, board.type, board.catalogId)
      .then((items) => {
        if (alive) setState(items);
      })
      .catch((error: unknown) => {
        if (alive) setState({ error: error instanceof Error ? error.message : 'o addon não respondeu' });
      });
    return () => {
      alive = false;
    };
  }, [board.addonId, board.type, board.catalogId]);

  let body: ReactNode;
  if (state === 'loading') body = <Skeleton label={`Carregando ${board.name}…`} rows={2} media />;
  else if ('error' in state) body = <EmptyState icon={<Icon name="alert" />} title={state.error} />;
  else if (state.length === 0) body = <EmptyState title="este catálogo está vazio agora" />;
  else
    body = state
      .slice(0, RAIL_ITEMS)
      .map((item) => (
        <PosterCard
          key={`${item.type}:${item.id}`}
          title={item.name}
          posterUrl={item.poster}
          meta={item.year ?? undefined}
          onClick={() => navigate(addonItemPath(board.addonId, item.type, item.id))}
        />
      ));

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
  const rails = railsOf(groups);
  if (rails.length === 0) {
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
      />
      {rails.map((board) => (
        <DiscoverRail key={board.key} board={board} />
      ))}
    </>
  );
}
