import { Artwork, Button, EmptyState, Skeleton, TextField } from '@juninmd/sonido';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { moveItem } from '../../server/lists/rules.ts';
import {
  deleteList,
  getAllListItems,
  type ListItemDto,
  type ListSummaryDto,
  removeTitleFromList,
  reorderList,
  updateList,
} from '../api/lists.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { useAlive } from '../library/use-alive.ts';
import { BackLink } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { libraryItemPath } from '../ui/title-link.ts';

type Data = { list: ListSummaryDto; items: ListItemDto[] } | 'loading' | 'error';

const errorText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

/** Nome e descrição da lista. */
function ListEditForm({
  list,
  busy,
  onSave,
  onCancel,
}: {
  list: ListSummaryDto;
  busy: boolean;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? '');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => ref.current?.querySelector('input')?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(name.trim(), description);
  };
  return (
    <form ref={ref} className="list-edit" onSubmit={submit}>
      <TextField label="Nome" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="Descrição (opcional)"
        multiline
        maxLength={500}
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="list-head-actions">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Salvar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Detalhe de uma lista: itens em ordem, com subir/descer por botão (teclado e mouse), remover, editar e excluir. */
export function ListDetailPage({ listId }: { listId: string }) {
  const [data, setData] = useState<Data>('loading');
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');
  /** Uma ação por vez: um clique novo antes da resposta enviaria uma ordem calculada sobre a base antiga. */
  const [busy, setBusy] = useState(false);
  const alive = useAlive();
  const listRef = useRef<HTMLOListElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    getAllListItems(listId)
      .then((res) => alive.current && setData({ list: res.list, items: res.items }))
      .catch(() => alive.current && setData('error'));
  }, []);

  // Devolve o foco ao mesmo item na nova posição (o botão recriado perderia o foco).
  useEffect(() => {
    if (focusIndex.current === null) return;
    const row = listRef.current?.children[focusIndex.current];
    focusIndex.current = null;
    if (row instanceof HTMLElement) row.focus();
  });

  if (data === 'loading') return <Skeleton label="Carregando lista…" rows={6} media />;
  if (data === 'error') {
    return (
      <EmptyState
        icon={<Icon name="alert" />}
        title="lista não encontrada ou indisponível"
        description={<a href="#/lists">voltar às listas</a>}
      />
    );
  }
  const { list, items } = data;
  const total = items.length;

  /** Roda um pedido com a trava `busy`; erro vai para a região viva. */
  const run = <T,>(request: Promise<T>, done: (res: T) => void, failure: string) => {
    setBusy(true);
    request
      .then((res) => alive.current && done(res))
      .catch((err: unknown) => alive.current && setStatus(errorText(err, failure)))
      .finally(() => alive.current && setBusy(false));
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = items.map((i) => i.titleId);
    const next = moveItem(ids, index, delta);
    const newIndex = next.indexOf(ids[index] ?? '');
    const moved = items[index];
    if (busy || !moved || newIndex === index) return;
    run(
      reorderList(listId, next),
      (res) => {
        // A ordem vem do servidor, não do cálculo local: é ela que ficou gravada.
        const byId = new Map(items.map((i) => [i.titleId, i]));
        const ordered = res.titleIds.map((id) => byId.get(id)).filter((i): i is ListItemDto => i !== undefined);
        focusIndex.current = newIndex;
        setData({ list, items: ordered });
        setStatus(`${moved.title.title} movido para a posição ${newIndex + 1} de ${ordered.length}`);
      },
      'não foi possível reordenar',
    );
  };

  const remove = (item: ListItemDto) => {
    if (busy) return;
    run(
      removeTitleFromList(listId, item.titleId),
      () => {
        setData({ list, items: items.filter((i) => i.titleId !== item.titleId) });
        setStatus(`${item.title.title} removido da lista`);
        showToast(`${item.title.title} removido da lista`);
      },
      'não foi possível remover',
    );
  };

  const save = (name: string, description: string) => {
    if (busy) return;
    run(
      updateList(listId, { name, description }),
      (updated) => {
        setData({ list: updated, items });
        setEditing(false);
        setStatus('nome e descrição salvos');
      },
      'não foi possível salvar',
    );
  };

  const destroy = () => {
    if (busy || !confirm(`Excluir a lista "${list.name}"? Os títulos continuam na biblioteca.`)) return;
    run(
      deleteList(listId),
      () => {
        showToast(`lista "${list.name}" excluída`);
        navigate('/lists');
      },
      'não foi possível excluir',
    );
  };

  return (
    <>
      <header className="view-head list-head">
        <BackLink href="#/lists" label="Listas" />
        <h1 className="view-title">{list.name}</h1>
        {list.description && <p className="view-subtitle">{list.description}</p>}
        <p className="list-meta">
          {total} título{total === 1 ? '' : 's'}
        </p>
        <div className="list-head-actions">
          <Button ref={editBtn} variant="ghost" size="sm" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            Editar nome e descrição
          </Button>
          <Button
            variant="danger"
            size="sm"
            iconStart={<Icon name="trash" size="sm" />}
            disabled={busy}
            onClick={destroy}
          >
            excluir lista
          </Button>
        </div>
      </header>
      {editing && (
        <ListEditForm
          list={list}
          busy={busy}
          onSave={save}
          onCancel={() => {
            setEditing(false);
            editBtn.current?.focus();
          }}
        />
      )}
      {total === 0 ? (
        <EmptyState
          icon={<Icon name="folder" />}
          title="lista vazia"
          description={'adicione títulos pela página de cada um ("Adicionar à lista") ou pela Biblioteca'}
        />
      ) : (
        <ol className="list-items" aria-label="Itens da lista, em ordem" ref={listRef}>
          {items.map((item, i) => {
            const name = item.title.title;
            const year = item.title.releaseDate?.slice(0, 4);
            return (
              <li key={item.titleId} className="list-item" tabIndex={-1}>
                <span className="list-pos" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="list-thumb" aria-hidden="true">
                  <Artwork title={name} src={item.title.posterUrl ?? undefined} ratio="poster" />
                </span>
                <a className="list-item-title" href={`#${libraryItemPath(item)}`}>
                  {name}
                  {year && <small> {year}</small>}
                </a>
                <span className="list-item-actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Subir ${name} na lista`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Descer ${name} na lista`}
                    disabled={i === total - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${name} da lista`}
                    disabled={busy}
                    onClick={() => remove(item)}
                  >
                    <Icon name="x" size="sm" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="list-status" role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
