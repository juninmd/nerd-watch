import type { StatsSummary } from '../../server/stats/summary.ts';
import { Accordion, BarChart, Card, DataTable, Heatmap } from '@juninmd/sonido';
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { heatLayout } from './insights.ts';
import { formatCount, formatDateBr, formatHours, genreRows, monthRows, plural, ratingRows, WEEKDAY_SHORT, weekdayRows } from './model.ts';
import { Legend, SERIES_FINISHED, SERIES_REWATCH, StackedColumns } from './stat-marks.tsx';

/** Tabela equivalente ao gráfico, recolhida: a mesma informação, em texto, para quem não enxerga o desenho. */
export function NumbersTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: string[][] }) {
  const columns = headers.map((h, i) => ({ key: String(i), label: h, render: (r: string[]) => r[i] ?? '' }));
  return (
    <Accordion
      className="stat-data"
      items={[
        {
          key: 'numbers',
          title: 'Ver os números',
          content: <DataTable label={caption} columns={columns} rows={rows} rowKey={(r) => r[0] ?? ''} />,
        },
      ]}
    />
  );
}

function Figure({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <Card padding="md" className={className ? `stat-figure ${className}` : 'stat-figure'}>
      <figure>
        <figcaption>{title}</figcaption>
        {children}
      </figure>
    </Card>
  );
}

/**
 * Em tela estreita o mapa rola na horizontal e começaria em janeiro. No ano corrente ele já abre com a semana de
 * hoje à vista (as últimas semanas são o que a pessoa quer ver); em ano passado, no fim do ano.
 */
const revealRecent = (scroller: HTMLElement, isCurrentYear: boolean): void => {
  if (scroller.scrollWidth <= scroller.clientWidth) return;
  const elapsed = isCurrentYear ? (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (366 * 86_400_000) : 1;
  scroller.scrollLeft = Math.max(0, scroller.scrollWidth * elapsed - scroller.clientWidth * 0.75);
};

function ActivityFigure({ s, isCurrentYear }: { s: StatsSummary; isCurrentYear: boolean }) {
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scroller.current) revealRecent(scroller.current, isCurrentYear);
  }, [isCurrentYear]);

  const p = s.period;
  const layout = heatLayout(s.year, p.days);
  const data = Array.from({ length: 7 }, () => new Array<number>(layout.weeks).fill(0));
  const tips = Array.from({ length: 7 }, () => new Array<string>(layout.weeks).fill('fora do ano'));
  for (const c of layout.cells) {
    (data[c.row] as number[])[c.col] = c.events;
    (tips[c.row] as string[])[c.col] = c.tip;
  }
  const monthAt = new Map(layout.months.map((m) => [m.col, m.label]));
  const streak = p.longestStreak;
  const summary = streak
    ? `${formatCount(p.activeDays)} ${plural(p.activeDays, 'dia ativo', 'dias ativos')}. Maior sequência: ${formatCount(streak.days)} ${plural(streak.days, 'dia', 'dias')}, de ${formatDateBr(streak.start)} a ${formatDateBr(streak.end)}.`
    : 'Nenhum dia com atividade neste ano.';
  return (
    <Figure title={`Atividade em ${s.year}`} className="stat-wide">
      <p className="stat-hint">{summary}</p>
      <section
        className="heat-scroll"
        ref={scroller}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: região rolável precisa de foco para rolar pelo teclado
        tabIndex={0}
        aria-label="Mapa de atividade, rola na horizontal"
      >
        <div className="stat-heat" style={{ '--cols': layout.weeks } as CSSProperties}>
          {/* Meses na coluna da semana em que começam; o Heatmap do Sonido só rotula a cada N colunas. */}
          <div className="heat-months" aria-hidden="true">
            <span />
            {Array.from({ length: layout.weeks }, (_, col) => (
              <span key={col}>{monthAt.get(col) ?? ''}</span>
            ))}
          </div>
          <Heatmap
            data={data}
            rowLabels={WEEKDAY_SHORT}
            colLabels={Array.from({ length: layout.weeks }, (_, c) => `sem. ${c + 1}`)}
            label={`Eventos por dia em ${s.year}`}
            format={(_v, r, c) => tips[r]?.[c] ?? ''}
          />
        </div>
      </section>
      <NumbersTable
        caption={`Dias com atividade em ${s.year}`}
        headers={['Dia', 'Eventos']}
        rows={p.days.map((d) => [formatDateBr(d.date), String(d.events)])}
      />
    </Figure>
  );
}

export function StatsCharts({ s, isCurrentYear }: { s: StatsSummary; isCurrentYear: boolean }) {
  const months = monthRows(s);
  const weekdays = weekdayRows(s);
  const ratings = ratingRows(s);
  const genres = genreRows(s);
  return (
    <div className="stat-charts">
      <ActivityFigure s={s} isCurrentYear={isCurrentYear} />
      <Figure title="Por mês" className="stat-main">
        <Legend
          items={[
            { label: 'Conclusões', color: SERIES_FINISHED },
            { label: 'Revisões', color: SERIES_REWATCH },
          ]}
        />
        <StackedColumns
          label="Conclusões e revisões por mês"
          colors={[SERIES_FINISHED, SERIES_REWATCH]}
          items={months.map((m) => ({ label: m.label, segments: [m.finished, m.rewatches], tips: [m.finishedTip, m.rewatchTip] }))}
        />
        <NumbersTable
          caption="Conclusões e revisões por mês"
          headers={['Mês', 'Conclusões', 'Revisões', 'Marcações', 'Tempo']}
          rows={months.map((m) => [m.label, String(m.finished), String(m.rewatches), String(m.progress), m.hours === null ? '—' : formatHours(m.hours)])}
        />
      </Figure>
      <Figure title="Dia da semana">
        <BarChart data={weekdays} label="Eventos por dia da semana" format={formatCount} />
        <NumbersTable caption="Eventos por dia da semana" headers={['Dia', 'Eventos']} rows={weekdays.map((w) => [w.label, String(w.value)])} />
      </Figure>
      <Figure title="Distribuição de notas">
        <BarChart data={ratings} label="Notas dos títulos concluídos" format={formatCount} />
        <NumbersTable caption="Notas dos títulos concluídos" headers={['Nota', 'Títulos']} rows={ratings.map((r) => [r.label, String(r.value)])} />
      </Figure>
      <Figure title="Gêneros mais vistos">
        {genres.length ? (
          <>
            <BarChart data={genres} label="Gêneros mais vistos no ano" orientation="bars" format={formatCount} />
            <NumbersTable caption="Gêneros mais vistos no ano" headers={['Gênero', 'Títulos']} rows={genres.map((g) => [g.label, String(g.value)])} />
          </>
        ) : (
          <p className="stat-hint">Nenhum gênero no catálogo ainda. Abrir o detalhe de um título preenche os gêneros.</p>
        )}
      </Figure>
    </div>
  );
}
