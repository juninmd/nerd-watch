import type { StatsSummary } from '../../server/stats/summary.ts';
import { escapeHtml } from '../components/card.ts';
import { icon } from '../icons.ts';
import {
  backlogView,
  formatCount,
  formatHours,
  genreRows,
  kpiCards,
  monthRows,
  plural,
  ratingRows,
  weekdayRows,
} from './model.ts';
import { barListSvg, columnChartSvg, dataTable, stackedColumnChartSvg } from './svg.ts';

/** Cores das séries: azul = conclusão, laranja = revisão (par validado para CVD no fundo da tela escura). */
export const SERIES_FINISHED = '#3987e5';
export const SERIES_REWATCH = '#d95926';
const SINGLE = '#3987e5';

const legend = (): string => `
  <ul class="stat-legend" aria-label="Legenda">
    <li><span class="swatch" style="background:${SERIES_FINISHED}" aria-hidden="true"></span>Conclusões</li>
    <li><span class="swatch" style="background:${SERIES_REWATCH}" aria-hidden="true"></span>Revisões</li>
  </ul>`;

const figure = (title: string, body: string, table: string, extra = ''): string => `
  <figure class="stat-figure">
    <figcaption>${escapeHtml(title)}</figcaption>${extra}
    <div class="stat-chart">${body}</div>
    ${table}
  </figure>`;

export const renderKpis = (s: StatsSummary): string =>
  kpiCards(s)
    .map(
      (k) => `
    <article class="stat-card" id="kpi-${k.id}">
      <p class="stat-label">${escapeHtml(k.label)}</p>
      <p class="stat-value">${escapeHtml(k.value)}</p>
      <p class="stat-hint">${escapeHtml(k.hint)}</p>
    </article>`,
    )
    .join('');

export const renderLibraryAndBacklog = (s: StatsSummary): string => {
  const lib = s.library;
  const wt = lib.watchTime;
  const b = backlogView(s);
  const missing =
    wt.missingTitles > 0 || wt.episodesWithoutRuntime > 0
      ? `${formatCount(wt.missingTitles)} ${plural(wt.missingTitles, 'título', 'títulos')} sem duração e ${formatCount(wt.episodesWithoutRuntime)} ${plural(wt.episodesWithoutRuntime, 'episódio', 'episódios')} sem duração ficaram de fora.`
      : 'Duração completa para todos os assistidos.';
  return `
    <section class="stats-wide" aria-labelledby="lib-title">
      <article class="stat-card">
        <h2 id="lib-title" class="stat-label">Biblioteca</h2>
        <p class="stat-value">${formatCount(lib.byStatus.watched)} <span class="stat-unit">${plural(lib.byStatus.watched, 'assistido', 'assistidos')}</span></p>
        <p class="stat-hint">Tempo estimado: ${formatHours(wt.hours)}. ${escapeHtml(missing)}</p>
        <p class="stat-hint">${formatCount(lib.byStatus.want)} quero ver · ${formatCount(lib.byStatus.watching)} assistindo · ${formatCount(lib.byStatus.dropped)} abandonados</p>
      </article>
      <article class="stat-card">
        <h2 class="stat-label">Fila (quero ver)</h2>
        <p class="stat-value stat-value-sm">${escapeHtml(b.headline)}</p>
        <p class="stat-hint">${escapeHtml(b.detail)}</p>
      </article>
    </section>`;
};

export const renderCharts = (s: StatsSummary): string => {
  const months = monthRows(s);
  const weekdays = weekdayRows(s);
  const ratings = ratingRows(s);
  const genres = genreRows(s);
  const monthChart = figure(
    'Por mês',
    stackedColumnChartSvg(
      months.map((m) => ({ label: m.label, segments: [m.finished, m.rewatches], tips: [m.finishedTip, m.rewatchTip] })),
      { label: 'Conclusões e revisões por mês', colors: [SERIES_FINISHED, SERIES_REWATCH] },
    ),
    dataTable(
      'Conclusões e revisões por mês',
      ['Mês', 'Conclusões', 'Revisões', 'Marcações', 'Tempo'],
      months.map((m) => [
        m.label,
        String(m.finished),
        String(m.rewatches),
        String(m.progress),
        m.hours === null ? '—' : formatHours(m.hours),
      ]),
    ),
    legend(),
  );
  const weekdayChart = figure(
    'Dia da semana',
    columnChartSvg(weekdays, { label: 'Eventos por dia da semana', color: SINGLE }),
    dataTable(
      'Eventos por dia da semana',
      ['Dia', 'Eventos'],
      weekdays.map((w) => [w.label, String(w.value)]),
    ),
  );
  const ratingChart = figure(
    'Distribuição de notas',
    columnChartSvg(ratings, { label: 'Notas dos títulos concluídos', color: SINGLE }),
    dataTable(
      'Notas dos títulos concluídos',
      ['Nota', 'Títulos'],
      ratings.map((r) => [r.label, String(r.value)]),
    ),
  );
  const genreChart = genres.length
    ? figure(
        'Gêneros mais vistos',
        barListSvg(genres, { label: 'Gêneros mais vistos no ano', color: SINGLE }),
        dataTable(
          'Gêneros mais vistos no ano',
          ['Gênero', 'Títulos'],
          genres.map((g) => [g.label, String(g.value)]),
        ),
      )
    : `<figure class="stat-figure"><figcaption>Gêneros mais vistos</figcaption><p class="stat-hint">Nenhum gênero no catálogo ainda. Abrir o detalhe de um título preenche os gêneros.</p></figure>`;
  return `<div class="stat-charts">${monthChart}${weekdayChart}${ratingChart}${genreChart}</div>`;
};

export const renderNotes = (s: StatsSummary): string => `
  <details class="stat-notes">
    <summary>Como calculamos</summary>
    <ul>
      <li>"Concluído" e "revisão" vêm do histórico da lista. Cada um conta uma exibição do título.</li>
      <li>Tempo assistido = duração do título por exibição (filme: duração; série: soma dos episódios com duração no catálogo). Sem duração, a exibição fica de fora e é contada, não tratada como zero.</li>
      <li>Marcar episódio é atividade, não tempo: aparece nos dias ativos e no mês, mas não soma horas.</li>
      <li>Datas são o dia civil no fuso do seu navegador (${escapeHtml(s.timezone)}), com horário de verão.</li>
      <li>Gêneros e notas contam cada título uma vez no ano.</li>
    </ul>
  </details>`;

export const renderEmptyYear = (year: number): string => `
  <p class="stat-empty" role="status">Nenhuma atividade registrada em ${year}. Os números abaixo ficam zerados até você concluir ou revisar um título nesse ano.</p>`;

export const renderNoData = (): string => `
  <div class="empty-state stat-empty-all"><div class="big">${icon('chart')}</div>
    Ainda não há dados para estatísticas. Marque títulos como assistidos na <a href="#/library">Biblioteca</a> e eles aparecem aqui.
  </div>`;

export const renderBody = (s: StatsSummary): string => {
  if (!s.hasData) return renderNoData();
  const empty = s.period.activeDays === 0 ? renderEmptyYear(s.year) : '';
  return `
    ${empty}
    <div class="stat-kpis">${renderKpis(s)}</div>
    ${renderLibraryAndBacklog(s)}
    ${renderCharts(s)}
    ${renderNotes(s)}`;
};
