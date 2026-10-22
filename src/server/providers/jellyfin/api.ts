import type { NewTelegramItem } from '../../repo/telegram.ts';
import { readSetting } from '../sources/settings.ts';
import {
  type Service,
  apiUrl,
  arrayOf,
  collectPages,
  durationSeconds,
  episodeCaption,
  getJson,
  getStream,
  getThumbBytes,
  safeRange,
  serverBase,
} from '../sources/media-server.ts';
import { syntheticMessageId } from '../sources/service.ts';
import { SourceError } from '../sources/types.ts';

export const JELLYFIN: Service = { name: 'Jellyfin', secretLabel: 'chave de API' };
export const HANDLE_PREFIX = 'jellyfin:';
const TICKS_PER_SECOND = 10_000_000;
const LIBRARY_ITEM_TYPES = 'Movie,Episode,Video';
const NOT_CONFIGURED = 'Jellyfin não configurado — informe endereço e chave em Conexões';
const API_KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
const MAX_INPUT = 200;

/** IDs do Jellyfin são GUIDs, com ou sem traços. Qualquer outra coisa nunca chega a um caminho de URL. */
export const normalizeGuid = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
};

export interface JellyfinItem {
  Id: string;
  Name?: string;
  Type?: string;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  RunTimeTicks?: number;
  DateCreated?: string;
  ImageTags?: { Primary?: string };
}

interface VirtualFolder {
  Name?: string;
  ItemId?: string;
}

const config = (): { base: URL; apiKey: string } => {
  const url = readSetting('JELLYFIN_URL');
  const apiKey = readSetting('JELLYFIN_API_KEY');
  if (!url || !apiKey) throw new SourceError(NOT_CONFIGURED, 501);
  if (!API_KEY_RE.test(apiKey)) throw new SourceError('chave de API com formato inválido — corrija em Conexões', 501);
  return { base: serverBase(url, JELLYFIN), apiKey };
};

/** Cabeçalho de autenticação oficial do Jellyfin (o esquema legado `X-Emby-Token` foi desligado no 12.x). */
const auth = (apiKey: string): Record<string, string> => ({ Authorization: `MediaBrowser Token="${apiKey}"` });

/** Biblioteca (ou coleção) pelo ID ou pelo nome. Nome é comparado, nunca usado em caminho ou parâmetro. */
export const findLibrary = async (input: string): Promise<{ id: string; name: string }> => {
  if (input.length > MAX_INPUT) throw new SourceError('nome da biblioteca longo demais', 400);
  const { base, apiKey } = config();
  const id = normalizeGuid(input);
  if (id) {
    const body = await getJson<{ Items?: JellyfinItem[] }>(JELLYFIN, apiUrl(base, '/Items', { ids: id, limit: '1' }), auth(apiKey), 'biblioteca não encontrada no Jellyfin');
    const found = body.Items?.[0];
    if (!found?.Name) throw new SourceError('biblioteca não encontrada no Jellyfin', 404);
    return { id, name: found.Name };
  }
  const folders = await getJson<VirtualFolder[]>(JELLYFIN, apiUrl(base, '/Library/VirtualFolders'), auth(apiKey), 'biblioteca não encontrada no Jellyfin');
  const wanted = input.trim().toLowerCase();
  const match = arrayOf<VirtualFolder>(folders).find((f) => f.Name?.trim().toLowerCase() === wanted && normalizeGuid(f.ItemId));
  const matchId = normalizeGuid(match?.ItemId);
  if (!match?.Name || !matchId) throw new SourceError('biblioteca não encontrada no Jellyfin (confira o nome ou use o ID)', 404);
  return { id: matchId, name: match.Name };
};

/** Itens de vídeo da biblioteca, do mais novo ao mais antigo, até o teto. */
export const listLibraryItems = async (libraryId: string): Promise<JellyfinItem[]> => {
  const { base, apiKey } = config();
  return collectPages<JellyfinItem>(async (start, size) => {
    const url = apiUrl(base, '/Items', {
      ParentId: libraryId,
      Recursive: 'true',
      IncludeItemTypes: LIBRARY_ITEM_TYPES,
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Fields: 'DateCreated',
      EnableTotalRecordCount: 'true',
      StartIndex: String(start),
      Limit: String(size),
    });
    const body = await getJson<{ Items?: JellyfinItem[]; TotalRecordCount?: number }>(JELLYFIN, url, auth(apiKey), 'biblioteca não encontrada no Jellyfin');
    return { items: arrayOf<JellyfinItem>(body.Items), total: typeof body.TotalRecordCount === 'number' ? body.TotalRecordCount : undefined };
  });
};

/** Arquivo original, sem transcodificação (`static=true`). Container que o navegador não toca falha no próprio player. */
export const streamItem = async (itemId: string, range: string | undefined): Promise<Response> => {
  const { base, apiKey } = config();
  const rangeHeader = safeRange(range);
  const headers = rangeHeader ? { ...auth(apiKey), Range: rangeHeader } : auth(apiKey);
  return getStream(JELLYFIN, apiUrl(base, `/Videos/${itemId}/stream`, { static: 'true' }), headers);
};

/** Capa primária, reduzida no servidor. Null quando não há capa ou a resposta passa do teto. */
export const primaryThumb = async (itemId: string): Promise<Uint8Array | null> => {
  const { base, apiKey } = config();
  return getThumbBytes(apiUrl(base, `/Items/${itemId}/Images/Primary`, { maxHeight: '480' }), auth(apiKey));
};

export const toItems = (items: JellyfinItem[]): NewTelegramItem[] =>
  items.flatMap((item) => {
    const id = normalizeGuid(item.Id);
    if (!id) return [];
    const created = item.DateCreated ?? null;
    const title = item.Name ?? '';
    return [
      {
        messageId: syntheticMessageId(created, id),
        caption: item.Type === 'Episode' ? episodeCaption(item.SeriesName, item.ParentIndexNumber, item.IndexNumber, title) : title,
        durationSeconds: durationSeconds(item.RunTimeTicks, TICKS_PER_SECOND),
        // Só marca que existe capa; o link de origem nunca vai ao navegador (o caminho é relativo e a capa vira arquivo local).
        thumbnailUrl: item.ImageTags?.Primary ? `/Items/${id}/Images/Primary` : null,
        postedAt: created,
        fileRef: id,
      },
    ];
  });

/** Handle do canal (`jellyfin:<id>`) de volta para o ID da biblioteca, ou null se o valor no banco estiver malformado. */
export const libraryIdOfHandle = (handle: string): string | null => (handle.startsWith(HANDLE_PREFIX) ? normalizeGuid(handle.slice(HANDLE_PREFIX.length)) : null);

export const validateApiKey = (value: string): string | null => (API_KEY_RE.test(value) ? null : 'chave de API com formato inválido (só letras, números e traços)');

export const jellyfinConfigured = (): boolean => Boolean(readSetting('JELLYFIN_URL') && readSetting('JELLYFIN_API_KEY'));
