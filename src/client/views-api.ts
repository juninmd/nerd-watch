import { json } from './api.ts';
import type { LibraryViewQuery } from '../server/saved-views/schema.ts';

/** Visões salvas da biblioteca (nome + filtro, ordem e layout). Espelha `routes/saved-views.ts`. */
export interface SavedViewDto {
  id: string;
  name: string;
  query: LibraryViewQuery;
  createdAt: string;
  updatedAt: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const listSavedViews = (): Promise<{ items: SavedViewDto[] }> => fetch('/api/views').then((r) => json<{ items: SavedViewDto[] }>(r));

export const createSavedView = (name: string, query: LibraryViewQuery): Promise<SavedViewDto> =>
  fetch('/api/views', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, query }) }).then((r) => json<SavedViewDto>(r));

export const updateSavedView = (id: string, patch: { name?: string; query?: LibraryViewQuery }): Promise<SavedViewDto> =>
  fetch(`/api/views/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) =>
    json<SavedViewDto>(r),
  );

export const deleteSavedView = (id: string): Promise<void> =>
  fetch(`/api/views/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error('não foi possível excluir a visão');
  });
