import type { LibraryHistoryKind, WatchStatus } from '../server/types.ts';

const LABELS: Record<LibraryHistoryKind, string> = {
  added: 'Adicionado à lista',
  started: 'Começou a assistir',
  finished: 'Marcado como assistido',
  dropped: 'Abandonado',
  rewatch_started: 'Revisão iniciada',
  status_changed: 'Status alterado',
  progress: 'Progresso',
};

const STATUS_NAMES: Record<WatchStatus, string> = {
  want: 'quero ver',
  watching: 'assistindo',
  watched: 'assistido',
  dropped: 'abandonado',
};

/** Frase curta de um evento. `detail` vem do servidor: `from->to` em mudança de status, `T2 E5` em progresso. */
export const describeHistoryEvent = (kind: LibraryHistoryKind, detail: string | null): string => {
  if (!detail) return LABELS[kind];
  if (kind === 'progress') return `${LABELS.progress}: ${detail}`;
  if (kind === 'status_changed') {
    const [from, to] = detail.split('->') as [WatchStatus, WatchStatus];
    const name = (s: WatchStatus | undefined) => (s && s in STATUS_NAMES ? STATUS_NAMES[s] : '?');
    return `${LABELS.status_changed}: ${name(from)} → ${name(to)}`;
  }
  return LABELS[kind];
};
