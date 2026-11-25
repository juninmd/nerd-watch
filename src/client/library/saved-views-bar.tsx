import { Button, FilterChips, Menu, TextField } from '@juninmd/sonido';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type LibraryViewQuery, serializeViewQuery } from '../../server/saved-views/schema.ts';
import { createSavedView, deleteSavedView, type SavedViewDto, updateSavedView } from '../api/saved-views.ts';
import { showToast } from '../app/state.ts';
import { useAlive } from './use-alive.ts';

export interface SavedViewsBarProps {
  views: SavedViewDto[];
  /** Combinação atual da biblioteca (filtro, origem, ordem, layout): é o que "Salvar visão" grava. */
  current: LibraryViewQuery;
  onApply: (view: SavedViewDto) => void;
  /** Busca as visões de novo depois de criar, renomear ou apagar. */
  onRefresh: () => Promise<unknown>;
}

type Editing = { mode: 'save' } | { mode: 'rename'; view: SavedViewDto } | null;

const errorText = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

/** Formulário de nome (salvar ou renomear): foco no campo ao abrir, Esc cancela. */
function NameForm({
  label,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };
  return (
    <form ref={ref} className="views-form" onSubmit={submit} onKeyDown={onKeyDown}>
      <TextField
        label={label}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        required
        autoComplete="off"
      />
      <Button type="submit" variant="primary" size="sm">
        {submitLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}

/** Visões salvas acima da biblioteca: aplicar pelos chips; salvar, renomear e excluir, todos por teclado. */
export function SavedViewsBar({ views, current, onApply, onRefresh }: SavedViewsBarProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const alive = useAlive();
  const currentKey = serializeViewQuery(current);
  const active = views.find((v) => serializeViewQuery(v.query) === currentKey)?.id ?? null;

  const save = (name: string) =>
    createSavedView(name, current)
      .then((view) => {
        showToast(`visão "${view.name}" salva`);
        if (alive.current) setEditing(null);
        return onRefresh();
      })
      .catch((err: unknown) => showToast(errorText(err, 'não foi possível salvar a visão')));

  const rename = (view: SavedViewDto, name: string) =>
    updateSavedView(view.id, { name })
      .then((updated) => {
        showToast(`visão renomeada para "${updated.name}"`);
        if (alive.current) setEditing(null);
        return onRefresh();
      })
      .catch((err: unknown) => showToast(errorText(err, 'não foi possível renomear')));

  const remove = (view: SavedViewDto) => {
    if (!confirm(`Excluir a visão "${view.name}"? As listas e os títulos não mudam.`)) return;
    deleteSavedView(view.id)
      .then(() => {
        showToast(`visão "${view.name}" excluída`);
        return onRefresh();
      })
      .catch((err: unknown) => showToast(errorText(err, 'não foi possível excluir')));
  };

  const manage = views.flatMap((v, i) => [
    {
      key: `rename-${v.id}`,
      label: `Renomear "${v.name}"`,
      separator: i > 0,
      onSelect: () => setEditing({ mode: 'rename', view: v }),
    },
    { key: `delete-${v.id}`, label: `Excluir "${v.name}"`, danger: true, onSelect: () => remove(v) },
  ]);

  return (
    <section className="views-bar" aria-label="Visões salvas">
      {views.length > 0 && (
        <FilterChips
          label="Aplicar visão salva"
          chips={views.map((v) => ({ key: v.id, label: v.name }))}
          value={active}
          onChange={(id) => {
            const view = views.find((v) => v.id === id);
            if (view) onApply(view);
          }}
        />
      )}
      <div className="views-actions">
        {editing?.mode === 'save' ? (
          <NameForm
            label="Nome da visão"
            initial=""
            submitLabel="Salvar"
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        ) : editing?.mode === 'rename' ? (
          <NameForm
            label={`Novo nome da visão "${editing.view.name}"`}
            initial={editing.view.name}
            submitLabel="Salvar nome"
            onSubmit={(name) => rename(editing.view, name)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing({ mode: 'save' })}>
              Salvar visão atual
            </Button>
            {views.length > 0 && <Menu trigger="Gerenciar visões" items={manage} />}
          </>
        )}
      </div>
    </section>
  );
}
