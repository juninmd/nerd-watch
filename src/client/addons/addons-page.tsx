import { Button, EmptyState, PageHeader, Skeleton, TextField } from '@juninmd/sonido';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { type AddonDto, installAddon, listAddons } from '../api/stremio.ts';
import { showToast } from '../app/state.ts';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { AddonRow } from './addon-row.tsx';

type ListState = AddonDto[] | 'loading' | 'error';

function AddonList({ list, onChanged }: { list: ListState; onChanged: () => void }) {
  if (list === 'loading') return <Skeleton label="Carregando addons…" rows={3} media />;
  if (list === 'error') return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar os addons" />;
  if (list.length === 0) return <EmptyState icon={<Icon name="plug" />} title="nenhum addon instalado ainda" />;
  return (
    <ul className="addon-list">
      {list.map((a) => (
        <AddonRow key={a.id} addon={a} onChanged={onChanged} />
      ))}
    </ul>
  );
}

export function AddonsPage() {
  const [list, setList] = useState<ListState>('loading');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);
  const inputId = useId();
  const focusInput = () => document.getElementById(inputId)?.focus();
  const loadSeq = useRef(0);
  const alive = useRef(true);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    return listAddons()
      .then((addons) => {
        if (alive.current && seq === loadSeq.current) setList(addons);
      })
      .catch(() => {
        if (alive.current && seq === loadSeq.current) setList('error');
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (!value) {
      setError('cole o link do manifest do addon');
      focusInput();
      return;
    }
    setError('');
    setInstalling(true);
    installAddon(value)
      .then((a) => {
        if (!alive.current) return;
        setUrl('');
        showToast(`Addon "${a.name}" instalado`);
        return load();
      })
      .catch((err: Error) => {
        if (!alive.current) return;
        setError(err.message);
        focusInput();
      })
      .finally(() => {
        if (alive.current) setInstalling(false);
      });
  };

  const hasCatalog = Array.isArray(list) && list.some((a) => a.catalogs.length > 0);

  return (
    <div className="addons-page">
      <PageHeader titleAs="h1"
        title="Addons do Stremio"
        leading={<BackButton fallback="/connections" />}
        description={
          <>
            Cole o link do <code>manifest.json</code> de um addon (ou <code>stremio://…</code>) para usar o catálogo, os detalhes, os streams e as
            legendas dele aqui dentro. Não há addon pré-instalado nem lista automática: você instala só o que escolher, e o conteúdo e a licença dele
            são responsabilidade de quem o publica. O link fica guardado só neste computador e não entra no backup.
          </>
        }
      />
      <form className="chip-row form-row" noValidate onSubmit={submit}>
        <TextField
          id={inputId}
          className="grow"
          label="link do manifest do addon"
          type="text"
          inputMode="url"
          placeholder="https://…/manifest.json"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={error || undefined}
        />
        <Button type="submit" size="sm" loading={installing} iconStart={<Icon name="plus" size="sm" />}>
          instalar
        </Button>
      </form>
      {hasCatalog && (
        <p className="chip-row">
          <Button variant="ghost" size="sm" href="#/descobrir" iconStart={<Icon name="grid" size="sm" />}>
            descobrir nos catálogos
          </Button>
        </p>
      )}
      <div aria-live="polite">
        <AddonList list={list} onChanged={() => void load()} />
      </div>
    </div>
  );
}
