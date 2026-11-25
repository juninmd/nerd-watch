import { Button } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import { getLibraryHistory, type LibraryHistoryItemDto } from '../api/index.ts';
import { describeHistoryEvent } from './library-history-format.ts';
import { useAlive } from './use-alive.ts';

const PAGE_SIZE = 20;

const whenLabel = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Histórico recolhido por padrão. `<details>` dá teclado (Enter/Espaço no resumo) e leitor de tela de graça. */
export function LibraryHistory({ titleId }: { titleId: string }) {
  const [items, setItems] = useState<LibraryHistoryItemDto[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const alive = useAlive();
  const listRef = useRef<HTMLOListElement>(null);
  const focusIndex = useRef<number | null>(null);

  // Foco no primeiro item novo: sem isso, teclado e leitor de tela voltam ao topo ao "Ver mais".
  useEffect(() => {
    const index = focusIndex.current;
    if (index === null) return;
    focusIndex.current = null;
    const target = listRef.current?.children[index];
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, [items]);

  const load = (): void => {
    if (loading) return;
    setLoading(true);
    const offset = items.length;
    getLibraryHistory(titleId, PAGE_SIZE, offset)
      .then((page) => {
        if (!alive.current) return;
        if (offset > 0 && page.items.length > 0) focusIndex.current = offset;
        setItems((prev) => [...prev, ...page.items]);
        setTotal(page.total);
        setStatus(page.total === 0 ? 'Nenhum evento registrado ainda.' : '');
      })
      .catch(() => {
        // Erro não apaga o que já foi carregado: só avisa e deixa tentar de novo.
        if (alive.current) setStatus('Não foi possível carregar o histórico. Tente de novo.');
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  };

  return (
    <details
      className="conn-more history-details"
      onToggle={(e) => {
        if (e.currentTarget.open && total === null) load();
      }}
    >
      <summary>Histórico</summary>
      <div className="history-body">
        <ol className="history-list" ref={listRef}>
          {items.map((item, i) => (
            <li key={i} tabIndex={-1}>
              <time dateTime={item.at}>{whenLabel(item.at)}</time>{' '}
              <span>{describeHistoryEvent(item.kind, item.detail)}</span>
            </li>
          ))}
        </ol>
        <p className="history-status" aria-live="polite">
          {status}
        </p>
        {total !== null && items.length < total && (
          <Button variant="ghost" size="sm" loading={loading} onClick={load}>
            Ver mais
          </Button>
        )}
      </div>
    </details>
  );
}
