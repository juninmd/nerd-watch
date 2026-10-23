import { json } from './api.ts';

/** Listas próprias (locais). Espelha as respostas de `routes/lists.ts`. */
export interface ListSummaryDto {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  /** Preenchido só quando a consulta pediu um título (botão "Adicionar à lista" da página do título). */
  containsTitle: boolean | null;
  createdAt: string;
  updatedAt: string;
  covers: Array<{ posterUrl: string | null }>;
}

export interface ListPageDto {
  items: ListSummaryDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListItemDto {
  titleId: string;
  position: number;
  addedAt: string;
  title: {
    sourceId: string;
    source: 'tmdb' | 'archive' | 'tvmaze' | 'anilist' | 'telegram';
    mediaType: 'movie' | 'tv';
    title: string;
    posterUrl: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
  };
}

export interface ListDetailDto {
  list: ListSummaryDto;
  items: ListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Respostas sem corpo (204) também passam pelo tratamento de erro com a mensagem do servidor. */
const ok = async (res: Response): Promise<void> => {
  if (res.ok) return;
  const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
  throw new Error(body.error ?? `erro ${res.status}`);
};

export const listLists = (opts: { limit?: number; offset?: number; titleId?: string } = {}): Promise<ListPageDto> => {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  if (opts.offset !== undefined) qs.set('offset', String(opts.offset));
  if (opts.titleId !== undefined) qs.set('titleId', opts.titleId);
  return fetch(`/api/lists?${qs}`).then((r) => json<ListPageDto>(r));
};

export const createList = (input: { name: string; description?: string | null }): Promise<ListSummaryDto> =>
  fetch('/api/lists', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }).then((r) => json<ListSummaryDto>(r));

export const getList = (id: string, opts: { limit?: number; offset?: number } = {}): Promise<ListDetailDto> => {
  const qs = new URLSearchParams({ limit: String(opts.limit ?? 200), offset: String(opts.offset ?? 0) });
  return fetch(`/api/lists/${encodeURIComponent(id)}?${qs}`).then((r) => json<ListDetailDto>(r));
};

export const updateList = (id: string, patch: { name?: string; description?: string | null }): Promise<ListSummaryDto> =>
  fetch(`/api/lists/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) =>
    json<ListSummaryDto>(r),
  );

export const deleteList = (id: string): Promise<void> => fetch(`/api/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(ok);

export const addTitlesToList = (id: string, titleIds: string[]): Promise<{ added: number; existing: number }> =>
  fetch(`/api/lists/${encodeURIComponent(id)}/items`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ titleIds }) }).then((r) =>
    json<{ added: number; existing: number }>(r),
  );

export const removeTitleFromList = (id: string, titleId: string): Promise<void> =>
  fetch(`/api/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(titleId)}`, { method: 'DELETE' }).then(ok);

/** Envia a ordem completa (todos os ids da lista, na nova sequência). */
export const reorderList = (id: string, titleIds: string[]): Promise<{ titleIds: string[] }> =>
  fetch(`/api/lists/${encodeURIComponent(id)}/order`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ titleIds }) }).then((r) =>
    json<{ titleIds: string[] }>(r),
  );

/** Todos os itens da lista, em páginas: a reordenação precisa da sequência inteira. */
export const getAllListItems = async (id: string): Promise<{ list: ListSummaryDto; items: ListItemDto[] }> => {
  const first = await getList(id, { limit: 200, offset: 0 });
  const items = [...first.items];
  for (let offset = items.length; offset < first.total; offset += 200) {
    const page = await getList(id, { limit: 200, offset });
    if (page.items.length === 0) break;
    items.push(...page.items);
  }
  return { list: first.list, items };
};
