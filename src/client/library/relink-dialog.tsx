import { Artwork, Button, Dialog, EmptyState, SearchField, Spinner } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { relinkLibrary, type SearchResultDto, search } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { posterPathOf } from '../catalog/search-results.tsx';
import { Icon } from '../ui/icon.tsx';
import { openOverlay } from '../ui/overlay.tsx';
import { titlePath } from '../ui/title-link.ts';
import { relinkCandidates } from './relink-model.ts';
import { useAlive } from './use-alive.ts';

type Results = SearchResultDto[] | 'idle' | 'loading' | 'error';

/** Busca no catálogo e troca o título da entrada pelo escolhido (o "Wrong match?" do stream-goat). */
function RelinkDialog({ titleId, current, initialQuery, onClose }: RelinkProps & { onClose: () => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Results>('idle');
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useAlive();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setResults('idle');
    setResults('loading');
    // Espera a digitação parar: cada tecla não vira uma chamada ao catálogo. Resposta de consulta antiga é ignorada.
    let live = true;
    const timer = setTimeout(() => {
      search(q)
        .then((r) => live && alive.current && setResults(relinkCandidates(r.results, current)))
        .catch(() => live && alive.current && setResults('error'));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const pick = (r: SearchResultDto) => {
    const key = `${r.source}:${r.sourceId}`;
    setBusy(key);
    relinkLibrary(titleId, {
      source: r.source,
      sourceId: r.sourceId,
      mediaType: r.mediaType,
      title: r.title,
      overview: r.overview,
      posterPath: posterPathOf(r) ?? null,
      releaseDate: r.releaseDate,
      voteAverage: r.voteAverage,
    })
      .then((moved) => {
        onClose();
        showToast(`vínculo trocado para ${r.title}`);
        navigate(titlePath(moved.source, moved.mediaType, moved.sourceId));
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'não foi possível trocar o vínculo');
        if (alive.current) setBusy(null);
      });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Vínculo errado?"
      description='Escolha o título certo. Status, nota, histórico e listas vão junto. Dica: "Duna 2021" filtra pelo ano.'
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      }
    >
      <SearchField value={query} onChange={setQuery} label="Buscar o título certo" placeholder="Nome e ano" autoFocus />
      <div className="relink-results" aria-live="polite">
        {results === 'loading' && <Spinner label="Buscando…" />}
        {results === 'error' && <EmptyState icon={<Icon name="alert" />} title="a busca falhou; tente de novo" />}
        {Array.isArray(results) && results.length === 0 && <EmptyState title="nada encontrado com esse nome" />}
        {Array.isArray(results) &&
          results.map((r) => (
            <button
              type="button"
              key={`${r.source}:${r.sourceId}`}
              className="relink-hit"
              disabled={busy !== null}
              onClick={() => pick(r)}
            >
              <Artwork title={r.title} src={r.posterUrl ?? undefined} ratio="poster" />
              <span>
                <b>{r.title}</b>
                <small>
                  {[r.releaseDate?.slice(0, 4), r.mediaType === 'tv' ? 'série' : 'filme', r.source].filter(Boolean).join(' · ')}
                </small>
              </span>
              {busy === `${r.source}:${r.sourceId}` && <Spinner size={16} />}
            </button>
          ))}
      </div>
    </Dialog>
  );
}

interface RelinkProps {
  titleId: string;
  /** Título vinculado agora: some da lista de candidatos. */
  current: { source: string; sourceId: string };
  initialQuery: string;
}

export const openRelinkDialog = (props: RelinkProps): void => {
  openOverlay((close) => <RelinkDialog {...props} onClose={close} />);
};

/** Link discreto da ficha: só aparece com o título na sua lista (é a entrada que muda de título). */
export function RelinkButton(props: RelinkProps) {
  return (
    <Button variant="ghost" size="sm" iconStart={<Icon name="link" size="sm" />} onClick={() => openRelinkDialog(props)}>
      Vínculo errado?
    </Button>
  );
}
