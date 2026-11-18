/** Compara a ficha de uma série na TMDB com a da TVmaze. Puro: recebe os dois lados já lidos, sem rede. */

export interface SideInfo {
  status: string | null;
  year: string | null;
  rating: number | null;
}

export interface CompareRow {
  field: 'status' | 'year' | 'rating';
  label: string;
  tmdb: string;
  tvmaze: string;
  /** `true` só quando as fontes discordam de verdade (nota com pouca diferença não conta). */
  differs: boolean;
}

type StatusGroup = 'running' | 'ended' | 'upcoming';

const STATUS_GROUP: Record<string, StatusGroup> = {
  'returning series': 'running',
  running: 'running',
  ended: 'ended',
  canceled: 'ended',
  'in production': 'upcoming',
  planned: 'upcoming',
  'in development': 'upcoming',
};

const STATUS_LABEL: Record<StatusGroup, string> = { running: 'Em exibição', ended: 'Encerrada', upcoming: 'Em produção' };

/** Grupo do status, ou `null` quando a fonte não diz nada comparável (ex.: "To Be Determined"). */
export const statusGroup = (raw: string | null): StatusGroup | null => (raw ? (STATUS_GROUP[raw.trim().toLowerCase()] ?? null) : null);

const statusText = (raw: string | null): string => {
  const g = statusGroup(raw);
  return g ? STATUS_LABEL[g] : (raw ?? '—');
};

/** Notas de escalas parecidas variam um pouco por natureza: só diferença de 1,0 ponto ou mais é divergência. */
export const RATING_GAP = 1;

export const compareSources = (tmdb: SideInfo, tvmaze: SideInfo): CompareRow[] => {
  const sa = statusGroup(tmdb.status);
  const sb = statusGroup(tvmaze.status);
  const rating = (r: number | null): string => (r ? r.toFixed(1) : '—');
  return [
    { field: 'status', label: 'Status', tmdb: statusText(tmdb.status), tvmaze: statusText(tvmaze.status), differs: sa !== null && sb !== null && sa !== sb },
    { field: 'year', label: 'Estreia', tmdb: tmdb.year ?? '—', tvmaze: tvmaze.year ?? '—', differs: Boolean(tmdb.year && tvmaze.year && tmdb.year !== tvmaze.year) },
    {
      field: 'rating',
      label: 'Nota',
      tmdb: rating(tmdb.rating),
      tvmaze: rating(tvmaze.rating),
      differs: Boolean(tmdb.rating && tvmaze.rating && Math.abs(tmdb.rating - tvmaze.rating) >= RATING_GAP),
    },
  ];
};

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Acha a série da TVmaze que é a mesma da TMDB: mesmo nome normalizado e ano de estreia a no máximo 1 de distância. `null` sem certeza. */
export const pickTvmazeMatch = <T extends { name: string; year: string | null }>(title: string, year: string | null, candidates: T[]): T | null =>
  candidates.find((c) => norm(c.name) === norm(title) && (!year || !c.year || Math.abs(Number(c.year) - Number(year)) <= 1)) ?? null;
