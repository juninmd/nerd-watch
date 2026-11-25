import { Select } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { addTitlesToList, type ListSummaryDto, listLists } from '../api/lists.ts';
import { showToast } from '../app/state.ts';
import { useAlive } from './use-alive.ts';

/**
 * Ação em lote da biblioteca: "adicionar selecionados a uma lista". O select volta ao placeholder depois de cada
 * escolha. Adicionar de novo é idempotente: o aviso diz quantos já estavam na lista.
 */
export function BulkAddToList({ ids, disabled }: { ids: string[]; disabled: boolean }) {
  const [lists, setLists] = useState<ListSummaryDto[] | null>([]);
  const alive = useAlive();

  useEffect(() => {
    listLists({ limit: 100 })
      .then((page) => alive.current && setLists(page.items))
      .catch(() => alive.current && setLists(null));
  }, []);

  const add = (listId: string) => {
    const name = lists?.find((l) => l.id === listId)?.name ?? 'lista';
    if (!listId || ids.length === 0) return;
    addTitlesToList(listId, ids)
      .then((res) =>
        showToast(`${res.added} adicionado(s) a "${name}"${res.existing > 0 ? `; ${res.existing} já estavam` : ''}`),
      )
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : 'não foi possível adicionar à lista'));
  };

  return (
    <Select
      label="Adicionar à lista"
      options={[
        { value: '', label: 'adicionar à lista…' },
        ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
      ]}
      value=""
      onChange={add}
      disabled={disabled || lists === null}
    />
  );
}
