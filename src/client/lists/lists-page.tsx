import { Button, EmptyState, Skeleton, TextField } from '@juninmd/sonido';
import { type FormEvent, useEffect, useState } from 'react';
import { listLibrary } from '../api/library.ts';
import { createList, type ListSummaryDto, listLists } from '../api/lists.ts';
import { listSavedViews } from '../api/saved-views.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { useAlive } from '../library/use-alive.ts';
import { Icon } from '../ui/icon.tsx';
import { ListCard } from './list-card.tsx';
import { type SmartList, smartLists } from './smart-lists.ts';

const PAGE = 48;

const plural = (n: number): string => `${n} título${n === 1 ? '' : 's'}`;

type Page = { shown: ListSummaryDto[]; total: number } | 'loading' | 'error';

/** Listas próprias: grade de cartões com capas, criação rápida e "carregar mais" (sem lista de tamanho ilimitado na tela). */
export function ListsPage() {
  const [page, setPage] = useState<Page>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [smart, setSmart] = useState<SmartList[] | 'error'>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const alive = useAlive();

  const load = (offset: number) => {
    if (offset > 0) setLoadingMore(true);
    listLists({ limit: PAGE, offset })
      .then((res) => {
        if (!alive.current) return;
        setPage((prev) => ({
          shown: offset === 0 || typeof prev === 'string' ? res.items : [...prev.shown, ...res.items],
          total: res.total,
        }));
      })
      .catch(() => {
        if (!alive.current) return;
        if (offset === 0) setPage('error');
        else showToast('não foi possível carregar mais listas');
      })
      .finally(() => alive.current && setLoadingMore(false));
  };

  useEffect(() => {
    load(0);
    // Falha aqui não derruba as listas comuns, mas a seção avisa em vez de sumir sem explicação.
    void Promise.all([listSavedViews(), listLibrary()])
      .then(([views, lib]) => alive.current && setSmart(smartLists(views.items, lib.items)))
      .catch(() => alive.current && setSmart('error'));
  }, []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (creating || !trimmed) return;
    setCreating(true);
    createList({ name: trimmed })
      .then((list) => {
        showToast(`lista "${list.name}" criada`);
        if (alive.current) navigate(`/lists/${encodeURIComponent(list.id)}`);
      })
      .catch((err: unknown) => {
        if (alive.current) setCreating(false);
        showToast(err instanceof Error ? err.message : 'não foi possível criar a lista');
      });
  };

  const grid = (() => {
    if (page === 'loading') return <Skeleton label="Carregando listas…" />;
    if (page === 'error')
      return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar as listas" />;
    if (page.shown.length === 0) {
      return (
        <EmptyState
          icon={<Icon name="folder" />}
          title="nenhuma lista ainda"
          description="crie a primeira acima, ou adicione títulos a uma lista pela página do título"
        />
      );
    }
    return (
      <div className="list-grid">
        {page.shown.map((l) => (
          <ListCard
            key={l.id}
            href={`#/lists/${encodeURIComponent(l.id)}`}
            name={l.name}
            sub={plural(l.itemCount)}
            label={`${l.name}, ${plural(l.itemCount)}`}
            covers={l.covers.map((c) => c.posterUrl)}
          />
        ))}
      </div>
    );
  })();

  return (
    <>
      <header className="view-head">
        <h1 className="view-title">Listas</h1>
        <p className="view-subtitle">Coleções suas, só neste computador. Um título pode estar em várias listas.</p>
      </header>
      <form className="lists-new" onSubmit={create}>
        <TextField
          label="Nome da nova lista"
          placeholder="nome da nova lista"
          maxLength={80}
          required
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" size="sm" iconStart={<Icon name="plus" size="sm" />} loading={creating}>
          criar lista
        </Button>
      </form>
      {grid}
      {typeof page === 'object' && page.shown.length < page.total && (
        <Button variant="ghost" size="sm" loading={loadingMore} onClick={() => load(page.shown.length)}>
          carregar mais ({page.total - page.shown.length})
        </Button>
      )}
      {(smart === 'error' || smart.length > 0) && (
        <section>
          <h2 className="view-title lists-smart-title">Listas inteligentes</h2>
          <p className="view-subtitle">
            Visões salvas da biblioteca. Elas se atualizam sozinhas conforme você marca e avalia. Crie novas na{' '}
            <a href="#/library">biblioteca</a>.
          </p>
          {smart === 'error' ? (
            <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar as listas inteligentes agora" />
          ) : (
            <div className="list-grid">
              {smart.map((l) => (
                // Mesmo cartão das listas comuns, com a regra no lugar do contador seco; leva à biblioteca já filtrada.
                <ListCard
                  key={l.id}
                  href={`#/library?view=${encodeURIComponent(l.id)}`}
                  name={l.name}
                  sub={`${plural(l.count)} · ${l.rule}`}
                  label={`${l.name}, ${plural(l.count)}, lista inteligente`}
                  covers={l.covers}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
