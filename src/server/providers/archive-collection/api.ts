import type { NewTelegramItem } from '../../repo/telegram.ts';
import { fetchCapped, makeFetch } from '../public-http.ts';
import { syntheticMessageId } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';

const http = makeFetch();
/** Só para testes: troca o `fetch` por um falso. */
export const setArchiveCollectionFetchForTests = (next?: Parameters<typeof http.set>[0]): void => http.set(next);

/** Identificador da Internet Archive (coleção ou item). Restrito: ele entra na query Lucene e em URLs. */
export const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const JSON_MAX_BYTES = 2 * 1024 * 1024;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const THUMB_HOST = /^(?:[a-z0-9-]+\.)*archive\.org$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetchCapped(http.get(), url, { headers: { Accept: 'application/json' } }, 20_000, JSON_MAX_BYTES).catch(() => {
    throw new SourceError('não foi possível falar com a Internet Archive agora', 502);
  });
  if (res.status === 404) throw new SourceError('coleção não encontrada na Internet Archive', 404);
  if (res.status < 200 || res.status >= 300) throw new SourceError(`a Internet Archive respondeu ${res.status}`, 502);
  if (!res.bytes) throw new SourceError('resposta grande demais da Internet Archive', 502);
  try {
    return JSON.parse(new TextDecoder().decode(res.bytes)) as unknown;
  } catch {
    throw new SourceError('resposta inesperada da Internet Archive', 502);
  }
};

export const thumbUrlOf = (identifier: string): string => `https://archive.org/services/img/${encodeURIComponent(identifier)}`;

/** Confere que o identificador existe e é mesmo uma coleção; devolve o título dela. */
export const fetchCollectionName = async (id: string): Promise<string> => {
  const body = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}/metadata`);
  const meta = isRecord(body) ? body.result : undefined;
  if (!isRecord(meta)) throw new SourceError('coleção não encontrada na Internet Archive', 404);
  if (meta.mediatype !== 'collection') throw new SourceError('esse identificador não é uma coleção da Internet Archive (use o link archive.org/details/<coleção>)', 400);
  const title = typeof meta.title === 'string' ? meta.title.trim() : '';
  return title || id;
};

const firstString = (value: unknown): string => (typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '');

/** Vídeos da coleção, dos mais novos aos mais antigos (data de publicação), até 300. */
export const listCollection = async (id: string): Promise<NewTelegramItem[]> => {
  const items: NewTelegramItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', `collection:(${id}) AND mediatype:(movies)`);
    url.searchParams.set('output', 'json');
    url.searchParams.set('rows', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort[]', 'publicdate desc');
    for (const field of ['identifier', 'title', 'publicdate']) url.searchParams.append('fl[]', field);
    const body = await getJson(url.href);
    const response = isRecord(body) ? body.response : undefined;
    if (!isRecord(response) || !Array.isArray(response.docs)) throw new SourceError('resposta inesperada da Internet Archive', 502);
    for (const doc of response.docs) {
      if (!isRecord(doc) || typeof doc.identifier !== 'string' || !ARCHIVE_ID.test(doc.identifier)) continue;
      const publicdate = typeof doc.publicdate === 'string' && Number.isFinite(Date.parse(doc.publicdate)) ? doc.publicdate : null;
      items.push({
        messageId: syntheticMessageId(publicdate, doc.identifier),
        caption: firstString(doc.title).trim() || doc.identifier,
        durationSeconds: null,
        thumbnailUrl: thumbUrlOf(doc.identifier),
        postedAt: publicdate,
        fileRef: doc.identifier,
      });
    }
    if (response.docs.length < PAGE_SIZE) break;
  }
  return items;
};

/** Miniatura: a Archive às vezes responde 302 para outro nó `*.archive.org`; seguimos no máximo um salto, só dentro do domínio. */
export const downloadThumb = async (identifier: string): Promise<Uint8Array | null> => {
  if (!ARCHIVE_ID.test(identifier)) return null;
  let url = thumbUrlOf(identifier);
  for (let hop = 0; hop < 2; hop++) {
    const res = await fetchCapped(http.get(), url, {}, 10_000, THUMB_MAX_BYTES).catch(() => null);
    if (!res) return null;
    if (res.status === 200) return res.bytes && res.bytes.length > 0 ? res.bytes : null;
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return null;
    try {
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || next.username || next.password || next.port || !THUMB_HOST.test(next.hostname)) return null;
      url = next.href;
    } catch {
      return null;
    }
  }
  return null;
};
