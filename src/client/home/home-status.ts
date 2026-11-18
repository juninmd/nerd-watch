import type { CalendarEntryDto, HealthResponse } from '../api/index.ts';
import type { SourceProbeDto } from '../api/health.ts';
import { plural } from '../stats/model.ts';

/** Faixa de números e saúde das fontes da tela inicial. Sem DOM: recebe o que a API já devolveu. */

export interface HomeKpi {
  value: string;
  label: string;
  hint?: string;
}

const DAY_MS = 86_400_000;
const isoMs = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** "hoje", "amanhã" ou "em N dias" para uma data ISO local; `null` se já passou. */
export const releaseIn = (dateIso: string, todayIso: string): string | null => {
  const days = Math.round((isoMs(dateIso) - isoMs(todayIso)) / DAY_MS);
  if (days < 0) return null;
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
};

export const nextRelease = (entries: CalendarEntryDto[], todayIso: string): CalendarEntryDto | null =>
  entries.filter((e) => e.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

export interface KpiInput {
  watching: number;
  queued: number;
  entries: CalendarEntryDto[];
  todayIso: string;
}

export const homeKpis = ({ watching, queued, entries, todayIso }: KpiInput): HomeKpi[] => {
  const kpis: HomeKpi[] = [
    { value: String(watching), label: 'em andamento' },
    { value: String(queued), label: plural(queued, 'episódio na fila', 'episódios na fila') },
  ];
  const next = nextRelease(entries, todayIso);
  if (next) kpis.push({ value: releaseIn(next.date, todayIso) ?? '', label: 'próximo lançamento', hint: next.titleName });
  return kpis;
};

export interface SourceRow {
  label: string;
  ok: boolean;
  detail: string;
}

/** Cada recurso opcional do servidor com o que falta ligar. Só reflete o que `/api/health` sabe. */
export const sourceRows = (h: HealthResponse, probes: SourceProbeDto[] = []): SourceRow[] => [
  ...probes.map((p) => ({ label: p.label, ok: p.ok, detail: p.ok && p.ms !== null ? `${p.ms} ms` : 'sem resposta' })),
  { label: 'TMDB', ok: h.tmdbEnabled, detail: h.tmdbEnabled ? 'catálogo ligado' : 'defina TMDB_API_KEY' },
  { label: 'Legendas', ok: h.openSubtitlesEnabled, detail: h.openSubtitlesEnabled ? 'OpenSubtitles ligado' : 'sem chave do OpenSubtitles' },
  { label: 'Torrent', ok: h.torrentEnabled, detail: h.torrentEnabled ? 'P2P ligado' : 'desligado' },
  { label: 'Telegram', ok: h.telegramBotEnabled, detail: h.telegramBotEnabled ? 'bot ligado' : 'bot não configurado' },
  { label: 'Avisos', ok: h.notifyEnabled, detail: h.notifyEnabled ? `${h.notifyLeadDays} dia(s) antes` : 'sem destino no .env' },
];
