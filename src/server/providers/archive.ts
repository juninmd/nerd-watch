import { withCache } from '../cache.ts';
import { isPlayableVideo } from '../media/playable.ts';

const MINUTES = 60_000;

/**
 * Internet Archive: sem chave, gratuito. Restrito à coleção `feature_films`,
 * curada pela própria Archive.org como domínio público / licença livre — é o
 * que garante que o player embutido e o torrent oficial abaixo são legais.
 * https://archive.org/details/feature_films
 */
const SEARCH_URL = 'https://archive.org/advancedsearch.php';
const METADATA_URL = 'https://archive.org/metadata';
const PUBLIC_DOMAIN_COLLECTION = 'feature_films';

export interface ArchiveDoc {
  identifier: string;
  title: string;
  description?: string | string[];
  /** A API da Archive.org devolve como number quando é um ano único; normalizamos para string em `toMovie`. */
  year?: string | number;
}

export interface ArchiveMovie {
  identifier: string;
  title: string;
  overview: string;
  year: string | null;
  thumbnailUrl: string;
  embedUrl: string;
  torrentUrl: string;
  detailsUrl: string;
  /** Legenda que a própria Archive.org já hospeda para o item (transcrição automática ou enviada por alguém). Nem todo item tem. */
  subtitleUrl: string | null;
  /**
   * Se o item tem algum arquivo que o navegador toca (MP4/WebM). `undefined` quando ainda não
   * buscamos a lista de arquivos (a busca por relevância não a devolve) — nesse caso não dá pra
   * afirmar nada, então a interface não esconde o player P2P.
   */
  hasPlayableVideo?: boolean;
}

export interface ArchiveFile {
  name: string;
  format?: string;
}

const SUBTITLE_FORMATS = new Set(['subrip', 'webvtt']);

export const pickSubtitleUrl = (identifier: string, files: ArchiveFile[] | undefined): string | null => {
  const sub = files?.find((f) => SUBTITLE_FORMATS.has((f.format ?? '').toLowerCase()) || /\.(srt|vtt)$/i.test(f.name));
  return sub ? `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(sub.name)}` : null;
};

const toOverview = (description: ArchiveDoc['description']): string => {
  if (!description) return '';
  const text = Array.isArray(description) ? description.join('\n') : description;
  return text.replace(/<[^>]+>/g, '').trim();
};

const toMovie = (doc: ArchiveDoc, subtitleUrl: string | null = null, hasPlayableVideo?: boolean): ArchiveMovie => {
  const id = encodeURIComponent(doc.identifier);
  return {
    identifier: doc.identifier,
    title: doc.title,
    overview: toOverview(doc.description),
    year: doc.year != null ? String(doc.year) : null,
    thumbnailUrl: `https://archive.org/services/img/${id}`,
    embedUrl: `https://archive.org/embed/${id}`,
    torrentUrl: `https://archive.org/download/${id}/${id}_archive.torrent`,
    detailsUrl: `https://archive.org/details/${id}`,
    subtitleUrl,
    hasPlayableVideo,
  };
};

/** Neutraliza sintaxe de busca do Lucene/Solr (parênteses, `:`, operadores booleanos) para o termo do
 *  usuário não conseguir escapar do escopo `collection:(feature_films) AND mediatype:(movies)` abaixo. */
const sanitizeSearchTerm = (raw: string): string =>
  raw
    .replace(/[+\-!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/g, (m) => m.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();

export const archiveSearchPublicDomain = withCache(15 * MINUTES, async (query: string, limit = 24): Promise<ArchiveMovie[]> => {
  const trimmed = sanitizeSearchTerm(query);
  const scoped = `collection:(${PUBLIC_DOMAIN_COLLECTION}) AND mediatype:(movies)`;
  const q = trimmed ? `${scoped} AND (${trimmed})` : scoped;
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('output', 'json');
  url.searchParams.set('rows', String(limit));
  url.searchParams.set('sort[]', 'downloads desc');
  for (const field of ['identifier', 'title', 'description', 'year']) url.searchParams.append('fl[]', field);

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Internet Archive respondeu ${res.status}`);
  const data = (await res.json()) as { response: { docs: ArchiveDoc[] } };
  return data.response.docs.filter((d) => d.title).map((doc) => toMovie(doc));
});

export const archiveMovieDetails = withCache(24 * 60 * MINUTES, async (identifier: string): Promise<ArchiveMovie | null> => {
  const res = await fetch(`${METADATA_URL}/${encodeURIComponent(identifier)}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Internet Archive respondeu ${res.status}`);
  const data = (await res.json()) as { metadata?: ArchiveDoc; files?: ArchiveFile[] };
  if (!data.metadata) return null;
  const hasPlayableVideo = (data.files ?? []).some((file) => isPlayableVideo(file.name));
  return toMovie({ ...data.metadata, identifier }, pickSubtitleUrl(identifier, data.files), hasPlayableVideo);
});
