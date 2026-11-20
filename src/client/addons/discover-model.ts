import type { AddonBoardDto } from '../api/stremio.ts';

/**
 * Modelo da tela Descobrir: achata os quadros (catálogos) dos addons instalados em uma seção por
 * addon, para os trilhos não repetirem o nome do addon em cada título. Sem DOM, testável direto.
 */
export interface BoardGroup {
  addonId: string;
  addonName: string;
  logo: string | null;
  host: string;
  boards: AddonBoardDto[];
}

/** Teto de trilhos na tela: cada trilho é uma requisição externa ao addon. */
export const MAX_RAILS = 8;
/** Teto de itens por trilho: o resto fica no "ver tudo" do addon. */
export const RAIL_ITEMS = 14;

export const groupBoards = (boards: readonly AddonBoardDto[]): BoardGroup[] => {
  const groups: BoardGroup[] = [];
  const byAddon = new Map<string, BoardGroup>();
  for (const board of boards) {
    const existing = byAddon.get(board.addonId);
    if (existing) {
      existing.boards.push(board);
      continue;
    }
    const group: BoardGroup = {
      addonId: board.addonId,
      addonName: board.addonName,
      logo: board.logo,
      host: board.host,
      boards: [board],
    };
    byAddon.set(board.addonId, group);
    groups.push(group);
  }
  return groups;
};

/**
 * Trilhos a carregar, na ordem de instalação dos addons. Filmes e séries primeiro: canais, podcasts
 * e afins costumam vir com capas ruins e o usuário está buscando o que assistir.
 */
export const railsOf = (groups: readonly BoardGroup[], max = MAX_RAILS): AddonBoardDto[] => {
  const weight = (type: string): number => (type === 'movie' || type === 'series' ? 0 : type === 'anime' ? 1 : 2);
  return groups
    .flatMap((group) => group.boards)
    .map((board) => ({ board, weight: weight(board.type) }))
    .sort((a, b) => a.weight - b.weight)
    .slice(0, max)
    .map((entry) => entry.board);
};
