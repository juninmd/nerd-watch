import { todayIso } from '../date.ts';
import type { MediaType } from '../types.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Série em exibição, ainda não estreada ou de status desconhecido: episódio novo pode sair a qualquer dia. */
export const AIRING_INTERVAL_MS = DAY_MS;
/** Série encerrada ou cancelada: só muda em reexibição ou correção; 30 dias basta. */
export const ENDED_INTERVAL_MS = 30 * DAY_MS;
/** Filme que ainda não lançou (ou sem data): data e pôster podem mudar até a estreia. */
export const UNRELEASED_MOVIE_INTERVAL_MS = DAY_MS;

const ENDED_STATUSES: ReadonlySet<string> = new Set(['Ended', 'Canceled']);

export interface RefreshableTitle {
  media_type: MediaType;
  release_date: string | null;
  metadata_status: string | null;
  metadata_refreshed_at: string | null;
}

/**
 * Intervalo do refresh automático, ou `null` quando não há mais o que esperar (filme já lançado).
 * Pura: `now` é injetado, então o teste não depende do relógio nem do fuso da máquina.
 */
export const autoRefreshIntervalMs = (title: RefreshableTitle, now: Date): number | null => {
  if (title.media_type === 'movie') {
    const released = !!title.release_date && title.release_date.slice(0, 10) <= todayIso(now);
    return released ? null : UNRELEASED_MOVIE_INTERVAL_MS;
  }
  return ENDED_STATUSES.has(title.metadata_status ?? '') ? ENDED_INTERVAL_MS : AIRING_INTERVAL_MS;
};

/** Precisa de refresh agora? Nunca atualizado sempre precisa; depois, só quando o intervalo venceu (limite inclusivo). */
export const needsRefresh = (title: RefreshableTitle, now: Date): boolean => {
  if (!title.metadata_refreshed_at) return true;
  const last = Date.parse(title.metadata_refreshed_at);
  if (Number.isNaN(last)) return true;
  const interval = autoRefreshIntervalMs(title, now);
  return interval !== null && now.getTime() - last >= interval;
};
