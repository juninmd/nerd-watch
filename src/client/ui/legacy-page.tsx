/**
 * TEMPORÁRIO durante a migração para React (ADR 0007): embrulha uma tela vanilla `(host, query) => void` num
 * componente. Sai quando a última tela virar React.
 */
import { type ReactNode, useLayoutEffect, useRef } from 'react';

type LegacyRender = (host: HTMLElement, query: URLSearchParams) => void;

function LegacyPage({ render, query }: { render: LegacyRender; query: URLSearchParams }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) render(ref.current, query);
  }, [render, query]);
  return <div ref={ref} className="legacy-page" />;
}

export const legacy =
  (render: LegacyRender) =>
  (query: URLSearchParams): ReactNode => <LegacyPage render={render} query={query} />;
