import { type AddonBoardDto, type AddonItemDto, getAddonCatalog, listBoards } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { escapeHtml, renderCard } from '../ui/card.ts';
import { backButtonHtml, wireBackButton } from '../ui/back-button.ts';
import { icon } from '../ui/icons.ts';
import { addonItemPath, addonPath } from './addon-links.ts';
import { groupBoards, RAIL_ITEMS, railsOf } from './discover-model.ts';

const railSkeleton = (): string => `<div class="rail">${Array.from({ length: 6 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>`;

const railSection = (board: AddonBoardDto): string => `
  <section class="section" data-board="${escapeHtml(board.key)}">
    <div class="section-head">
      <h2>${icon('grid', 'sm')} ${escapeHtml(board.addonName)} · ${escapeHtml(board.name)}</h2>
      <a href="#${addonPath(board.addonId)}">ver tudo</a>
    </div>
    ${railSkeleton()}
  </section>`;

/**
 * Tela Descobrir: um trilho por catálogo dos addons instalados. O catálogo é de terceiros e cada
 * trilho é uma requisição externa, então a tela limita quantidade e itens e preenche em paralelo:
 * um addon lento ou fora do ar só deixa o próprio trilho com aviso.
 */
export const renderDiscover = (host: HTMLElement): void => {
  host.innerHTML = `${backButtonHtml()}<div class="skeleton" style="height:120px;border-radius:20px"></div>`;
  wireBackButton(host, '/addons');

  listBoards()
    .then((boards) => {
      const groups = groupBoards(boards);
      const rails = railsOf(groups);
      if (rails.length === 0) {
        host.innerHTML = `
          ${backButtonHtml()}
          <header class="view-head"><h1 class="view-title">Descobrir nos addons</h1></header>
          <div class="empty-state">
            <div class="big">${icon('puzzle')}</div>
            nenhum addon instalado publica catálogo — os que só entregam streams aparecem na página do título.
            <p><a class="btn btn-primary btn-sm" href="#/addons">gerenciar addons</a></p>
          </div>`;
        wireBackButton(host, '/addons');
        return;
      }
      host.innerHTML = `
        ${backButtonHtml()}
        <header class="view-head">
          <h1 class="view-title">Descobrir nos addons</h1>
          <p class="view-subtitle">${rails.length} catálogo(s) de ${groups.length} addon(s). O conteúdo é de quem publica cada addon.</p>
        </header>
        ${rails.map(railSection).join('')}`;
      wireBackButton(host, '/addons');
      for (const board of rails) void fillRail(host, board);
    })
    .catch(() => {
      host.innerHTML = `${backButtonHtml()}<div class="empty-state" role="alert"><div class="big">${icon('alert')}</div>não foi possível listar os catálogos dos addons</div>`;
      wireBackButton(host, '/addons');
    });
};

const fillRail = async (host: HTMLElement, board: AddonBoardDto): Promise<void> => {
  const section = host.querySelector<HTMLElement>(`[data-board="${CSS.escape(board.key)}"]`);
  const rail = section?.querySelector<HTMLElement>('.rail');
  if (!section || !rail) return;

  let items: AddonItemDto[];
  try {
    items = await getAddonCatalog(board.addonId, board.type, board.catalogId);
  } catch (error) {
    if (!rail.isConnected) return;
    rail.innerHTML = `<div class="empty-state" style="flex:1" role="alert">${escapeHtml(error instanceof Error ? error.message : 'o addon não respondeu')}</div>`;
    return;
  }
  // A pessoa pode ter saído da tela antes da resposta chegar.
  if (!rail.isConnected) return;
  rail.replaceChildren();
  if (items.length === 0) {
    rail.innerHTML = '<div class="empty-state" style="flex:1">este catálogo está vazio agora</div>';
    return;
  }
  for (const item of items.slice(0, RAIL_ITEMS)) {
    rail.appendChild(renderCard({ title: item.name, posterUrl: item.poster, meta: item.year ?? undefined, onClick: () => navigate(addonItemPath(board.addonId, item.type, item.id)) }));
  }
};
