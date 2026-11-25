import { Button, Checkbox, TextField } from '@juninmd/sonido';
import { type FormEvent, useId, useRef, useState } from 'react';
import { addTitlesToList, createList, type ListSummaryDto, listLists, removeTitleFromList } from '../api/lists.ts';
import { showToast } from '../app/state.ts';
import { useAlive } from '../library/use-alive.ts';
import { Icon } from '../ui/icon.tsx';

const errorText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

/**
 * "Adicionar à lista" na página do título: um painel com uma caixa por lista (marcada = o título está nela) e um campo
 * para criar uma lista nova já com o título dentro. Cada marcação grava na hora; o estado é anunciado numa região viva.
 */
export function AddToList({ titleId }: { titleId: string }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ListSummaryDto[] | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const alive = useAlive();
  const loadSeq = useRef(0);

  const load = () => {
    const seq = ++loadSeq.current;
    return listLists({ limit: 100, titleId })
      .then((page) => {
        if (alive.current && seq === loadSeq.current) setLists(page.items);
      })
      .catch(() => {
        if (alive.current && seq === loadSeq.current) setStatus('não foi possível carregar as listas');
      });
  };

  const setPendingFor = (id: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const setContains = (id: string, containsTitle: boolean) =>
    setLists((prev) => prev?.map((l) => (l.id === id ? { ...l, containsTitle } : l)) ?? prev);

  const toggleList = (list: ListSummaryDto, checked: boolean) => {
    if (pending.has(list.id)) return;
    setPendingFor(list.id, true);
    setContains(list.id, checked);
    const request = checked ? addTitlesToList(list.id, [titleId]) : removeTitleFromList(list.id, titleId);
    request
      .then(() => {
        const message = checked ? `adicionado a "${list.name}"` : `removido de "${list.name}"`;
        showToast(message);
        if (alive.current) setStatus(message);
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setContains(list.id, !checked);
        setStatus(errorText(err, 'não foi possível atualizar a lista'));
      })
      .finally(() => alive.current && setPendingFor(list.id, false));
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (creating || !name) return;
    setCreating(true);
    createList({ name })
      .then((list) => addTitlesToList(list.id, [titleId]).then(() => list))
      .then((list) => {
        const message = `lista "${list.name}" criada com este título`;
        showToast(message);
        if (!alive.current) return;
        setNewName('');
        setStatus(message);
        return load();
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        setStatus(errorText(err, 'não foi possível criar a lista'));
        // Se a lista foi criada e só a adição falhou, recarregar mostra a lista vazia em vez de criar outra no próximo clique.
        void load();
      })
      .finally(() => alive.current && setCreating(false));
  };

  return (
    <div className="add-to-list">
      <Button
        variant="ghost"
        size="sm"
        iconStart={<Icon name="plus" size="sm" />}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) void load();
          setOpen(!open);
        }}
      >
        Adicionar à lista
      </Button>
      <div className="atl-panel" id={panelId} hidden={!open}>
        <fieldset className="atl-options">
          <legend>Listas</legend>
          {lists?.length === 0 && <p className="atl-empty">Nenhuma lista ainda. Crie uma abaixo.</p>}
          <div className="atl-checks">
            {lists?.map((l) => (
              <Checkbox
                key={l.id}
                label={l.name}
                checked={l.containsTitle === true}
                disabled={pending.has(l.id)}
                onChange={(checked) => toggleList(l, checked)}
              />
            ))}
          </div>
        </fieldset>
        <form className="atl-new" onSubmit={create}>
          <TextField
            label="Nome da nova lista"
            placeholder="nova lista…"
            maxLength={80}
            autoComplete="off"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" variant="ghost" size="sm" loading={creating}>
            Criar e adicionar
          </Button>
        </form>
        <p className="atl-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </div>
  );
}
