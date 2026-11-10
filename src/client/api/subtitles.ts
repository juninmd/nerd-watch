import { json } from './http.ts';

/** Uma legenda, venha de addon (URL direta) ou da OpenSubtitles (precisa de POST). */
export interface SubtitleResultDto {
  source: string;
  id: string;
  languageCode: string;
  language: string;
  release: string;
  downloads: number | null;
  directUrl?: string;
  fileId?: number;
}

export interface SubtitleSearchResponse {
  enabled: boolean;
  /** Por que está desabilitado: sem fonte configurada, ou sem id do IMDb para as fontes. */
  reason?: 'no_sources' | 'no_imdb_id';
  /** Id do IMDb do título — devolvido pelo servidor para o download não precisar traduzir de novo. */
  imdbId: string | null;
  sources: string[];
  unavailable: string[];
  results: SubtitleResultDto[];
}

export interface SubtitleSearchInput {
  query?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  imdbId?: string;
  season?: number | null;
  episode?: number | null;
}

export const searchSubtitles = (opts: SubtitleSearchInput): Promise<SubtitleSearchResponse> => {
  const params = new URLSearchParams();
  if (opts.query) params.set('query', opts.query);
  if (opts.tmdbId) params.set('tmdbId', String(opts.tmdbId));
  if (opts.mediaType) params.set('mediaType', opts.mediaType);
  if (opts.imdbId) params.set('imdbId', opts.imdbId);
  if (opts.season) params.set('season', String(opts.season));
  if (opts.episode) params.set('episode', String(opts.episode));
  return fetch(`/api/subtitles?${params}`).then((r) => json<SubtitleSearchResponse>(r));
};

export type SubtitleDownloadInput =
  | { fileId: number }
  | {
      source: string;
      id: string;
      imdbId?: string;
      tmdbId?: number;
      mediaType?: 'movie' | 'tv';
      season?: number | null;
      episode?: number | null;
    };

export const downloadSubtitle = (input: SubtitleDownloadInput): Promise<{ url: string; remaining?: number }> =>
  fetch('/api/subtitles/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => json<{ url: string; remaining?: number }>(r));

/** Pedido de legenda para o player: a mesma escolha de download, ou a legenda que o Internet Archive hospeda. */
export type SubtitleVttInput = SubtitleDownloadInput | { archiveId: string };

/** Texto WebVTT pronto para o `<track>`. Erro vem com mensagem fixa do servidor (nunca HTML da fonte). */
export const fetchSubtitleVtt = (input: SubtitleVttInput): Promise<string> =>
  fetch('/api/subtitles/vtt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(async (r) => {
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `erro ${r.status}`);
    }
    return r.text();
  });
