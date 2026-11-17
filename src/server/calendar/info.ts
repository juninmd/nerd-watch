import { httpsUrlOrNull } from '../lib/catalog-text.ts';

export type CalendarOrigin = 'serie' | 'filme' | 'anime';
/** Onde o título chega: serviço de streaming, sala de cinema, TV aberta/paga ou ainda sem informação. */
export type CalendarWhere = 'stream' | 'cinema' | 'tv' | 'desconhecido';

export interface CalendarProvider {
  name: string;
  /** Link do serviço/emissora; `null` quando a fonte só informa o nome. */
  url: string | null;
}

/** Ficha de um item da Agenda: tudo que o cartão e o detalhe mostram além do título e da data. */
export interface CalendarInfo {
  origin: CalendarOrigin;
  where: CalendarWhere;
  providers: CalendarProvider[];
  pageUrl: string | null;
  officialUrl: string | null;
  /** Id de vídeo do YouTube (validado: vira URL de iframe no cliente). */
  trailerKey: string | null;
  /** Busca de trailer no YouTube, usada quando a fonte não traz um vídeo. */
  trailerSearchUrl: string;
  synopsis: string | null;
  /** Nota de 0 a 10. */
  rating: number | null;
  genres: string[];
  backdropUrl: string | null;
}

const TRAILER_KEY_RE = /^[A-Za-z0-9_-]{6,32}$/;

export const validTrailerKey = (key: unknown): string | null => (typeof key === 'string' && TRAILER_KEY_RE.test(key) ? key : null);

export const trailerSearchUrl = (name: string, year?: string | null): string =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} ${year ?? ''} trailer oficial`.replace(/\s+/g, ' ').trim())}`;

/** Sinopse longa demais pesa no JSON da lista: o detalhe completo vem de `/api/calendar/detail`. */
export const clip = (text: string | null, max = 420): string | null => {
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
};

export const buildInfo = (input: Partial<CalendarInfo> & Pick<CalendarInfo, 'origin' | 'where'> & { name: string; year?: string | null }): CalendarInfo => ({
  origin: input.origin,
  where: input.where,
  providers: (input.providers ?? []).map((p) => ({ name: p.name, url: httpsUrlOrNull(p.url) })),
  pageUrl: httpsUrlOrNull(input.pageUrl),
  officialUrl: httpsUrlOrNull(input.officialUrl),
  trailerKey: validTrailerKey(input.trailerKey),
  trailerSearchUrl: trailerSearchUrl(input.name, input.year),
  synopsis: input.synopsis ?? null,
  rating: input.rating ?? null,
  genres: input.genres ?? [],
  backdropUrl: httpsUrlOrNull(input.backdropUrl),
});
