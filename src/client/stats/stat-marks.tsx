/**
 * Gráficos que o Sonido ainda não tem: colunas empilhadas (duas séries) e barra de composição (partes de um todo).
 * Pendência do ADR 0007: sobem para o Sonido. A geometria é pura, em charts.ts.
 *
 * Cada marca é focável e leva o texto em `aria-label` e `title` (como o Heatmap do Sonido), então teclado, leitor de
 * tela e mouse alcançam o mesmo dado. A tabela equivalente fica no "Ver os números" de cada gráfico.
 */
import type { CSSProperties } from 'react';
import { type BarPart, formatTick, pct, type StackedItem, segmentBlocks, stackedLayout } from './charts.ts';

/** Cores das séries: azul = conclusão, laranja = revisão (par validado para CVD no fundo da tela escura). */
export const SERIES_FINISHED = '#3987e5';
export const SERIES_REWATCH = '#d95926';

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="stat-legend" aria-label="Legenda">
      {items.map((it) => (
        <li key={it.label}>
          <span className="swatch" style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Colunas empilhadas (ex.: conclusões + revisões por mês), com 2 px de fundo entre os segmentos. */
export function StackedColumns({ items, label, colors }: { items: StackedItem[]; label: string; colors: string[] }) {
  const { ticks, max, columns } = stackedLayout(items);
  return (
    // biome-ignore lint/a11y/useSemanticElements: grupo de marcas de gráfico, não campos de formulário (fieldset)
    <div className="chart chart-cols" role="group" aria-label={label} style={{ '--cols': Math.max(columns.length, 1) } as Vars}>
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ '--at': pct(t, max) } as Vars}>
              <i>{formatTick(t)}</i>
            </span>
          ))}
        </div>
        <div className="chart-bars">
          {columns.map((col, i) => (
            // column-reverse no CSS: o primeiro segmento fica na base, e o rótulo (último) acima da ponta.
            <div className="chart-col" key={col.label}>
              {col.segments.map((s) => (
                <div
                  key={s.series}
                  className={s.cap ? 'chart-bar is-cap' : 'chart-bar'}
                  style={{ '--h': pct(s.value, max), '--i': i, background: colors[s.series] ?? colors[0] } as Vars}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: marca focável, o teclado alcança o mesmo dado do mouse
                  tabIndex={0}
                  role="img"
                  aria-label={s.tip}
                  title={s.tip}
                />
              ))}
              {col.capLabel !== null && (
                <span className="chart-val" aria-hidden="true">
                  {col.capLabel}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {columns.map((c) => (
          <span key={c.label}>{c.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Um todo dividido em partes (composição da biblioteca). A legenda segue a ordem dos blocos. */
export function SegmentedBar({ parts, label }: { parts: BarPart[]; label: string }) {
  const blocks = segmentBlocks(parts);
  if (blocks.length === 0) return null;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: grupo de marcas de gráfico, não campos de formulário (fieldset) */}
      <div className="seg-bar" role="group" aria-label={label}>
        {blocks.map((p, i) => (
          <div
            key={p.label}
            className="seg"
            style={{ '--share': p.value, '--i': i, background: p.color } as Vars}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: marca focável, o teclado alcança o mesmo dado do mouse
            tabIndex={0}
            role="img"
            aria-label={p.tip}
            title={p.tip}
          >
            {p.text}
          </div>
        ))}
      </div>
      <Legend items={blocks} />
    </>
  );
}
