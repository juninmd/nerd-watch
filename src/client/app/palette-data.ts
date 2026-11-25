import { listLibrary, listTelegramChannels } from '../api/index.ts';
import { listSavedViews } from '../api/saved-views.ts';
import { handleLabel } from '../connections/source-modes.ts';
import { openPickDialog } from '../library/pick-dialog.tsx';
import { libraryItemPath } from '../ui/title-link.ts';
import type { PaletteEntry } from './palette-search.ts';
import { navigate } from './router.ts';
import { getThemePref, nextThemePref, setThemePref } from './theme.ts';

const STATUS_LABEL: Record<string, string> = { want: 'quero ver', watching: 'assistindo', watched: 'assistido', dropped: 'abandonado' };

/** Ações fixas: navegação e atalhos. Os mesmos atalhos "g + letra" são registrados em `shortcuts.ts`. */
export const staticActions = (): PaletteEntry[] => [
  { id: 'go-home', group: 'Ações', title: 'Ir para o Início', keys: 'g h', run: () => navigate('/') },
  { id: 'go-library', group: 'Ações', title: 'Ir para a Biblioteca', keys: 'g b', run: () => navigate('/library') },
  { id: 'go-telegram', group: 'Ações', title: 'Ir para o Telegram', keys: 'g t', run: () => navigate('/telegram') },
  { id: 'go-lists', group: 'Ações', title: 'Ir para as Listas', keys: 'g l', run: () => navigate('/lists') },
  { id: 'go-stats', group: 'Ações', title: 'Ir para as Estatísticas', keys: 'g e', run: () => navigate('/stats') },
  { id: 'go-agenda', group: 'Ações', title: 'Ir para a Agenda', keys: 'g a', run: () => navigate('/agenda') },
  { id: 'go-connections', group: 'Ações', title: 'Ir para as Conexões', keys: 'g c', run: () => navigate('/connections') },
  { id: 'pick', group: 'Ações', title: 'O que assistir hoje (sorteio)', run: () => openPickDialog() },
  { id: 'telegram-import', group: 'Ações', title: 'Importar meus canais do Telegram', run: () => navigate('/telegram?import=1') },
  { id: 'go-search', group: 'Ações', title: 'Buscar títulos no catálogo', keys: 'g s', run: () => navigate('/search') },
  { id: 'go-pd', group: 'Ações', title: 'Explorar o domínio público', keys: 'g p', run: () => navigate('/public-domain') },
  { id: 'go-addons', group: 'Ações', title: 'Gerenciar addons do Stremio', keys: 'g o', run: () => navigate('/addons') },
  { id: 'backup', group: 'Ações', title: 'Exportar ou importar backup', keys: 'g d', run: () => navigate('/data?focus=backup') },
  { id: 'go-credentials', group: 'Ações', title: 'Gerenciar credenciais', keys: 'g k', run: () => navigate('/credentials') },
  { id: 'go-settings', group: 'Ações', title: 'Ajustes e avisos', keys: 'g j', run: () => navigate('/settings') },
  { id: 'theme', group: 'Ações', title: 'Alternar tema (escuro, claro, sistema)', run: () => setThemePref(nextThemePref(getThemePref())) },
];

/** Entrada que depende do texto digitado: leva a busca para a tela do catálogo. */
export const catalogEntry = (q: string): PaletteEntry => ({
  id: 'catalog',
  group: 'Catálogo',
  title: `Buscar “${q}” no catálogo`,
  sub: 'filmes, séries e novelas',
  run: () => navigate(`/search?q=${encodeURIComponent(q)}`),
});

let dataPromise: Promise<PaletteEntry[]> | null = null;
let loadedAt = 0;
const TTL_MS = 30_000;

/** Biblioteca e canais mudam pouco entre aberturas da paleta: reaproveita por 30s em vez de refazer 2 requests a cada Ctrl+K. */
export const loadDataEntries = (): Promise<PaletteEntry[]> => {
  if (dataPromise && Date.now() - loadedAt < TTL_MS) return dataPromise;
  loadedAt = Date.now();
  dataPromise = Promise.allSettled([listLibrary(), listTelegramChannels(), listSavedViews()]).then(([lib, ch, sv]) => {
    // Se todas as fontes falharam, não guarda lista vazia no cache por 30 s.
    if (lib.status === 'rejected' && ch.status === 'rejected' && sv.status === 'rejected') dataPromise = null;
    // Visões salvas viram ações: Ctrl K + nome aplica a visão na biblioteca de uma vez.
    const views: PaletteEntry[] =
      sv.status === 'fulfilled'
        ? sv.value.items.map((v) => ({
            id: `view:${v.id}`,
            group: 'Ações',
            title: `Visão: ${v.name}`,
            sub: 'biblioteca',
            run: () => navigate(`/library?view=${encodeURIComponent(v.id)}`),
          }))
        : [];
    const titles: PaletteEntry[] =
      lib.status === 'fulfilled'
        ? lib.value.items.map((it) => ({
            id: `title:${it.id}`,
            group: 'Títulos',
            title: it.title.title,
            sub: [it.title.releaseDate?.slice(0, 4), STATUS_LABEL[it.watchStatus]].filter(Boolean).join(' · '),
            run: () => navigate(libraryItemPath(it)),
          }))
        : [];
    const channels: PaletteEntry[] =
      ch.status === 'fulfilled'
        ? ch.value.channels.map((c) => ({
            id: `channel:${c.titleId}`,
            group: 'Canais',
            title: handleLabel(c.handle, c.title),
            sub: `${c.itemCount} vídeo${c.itemCount === 1 ? '' : 's'}`,
            run: () => navigate(`/telegram/${c.titleId}`),
          }))
        : [];
    return [...titles, ...channels, ...views];
  });
  return dataPromise;
};

/** Invalida o cache (ex.: depois de importar canais ou mudar a biblioteca). */
export const invalidatePaletteData = (): void => {
  dataPromise = null;
};
