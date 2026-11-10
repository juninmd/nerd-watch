import type { StatsSummary } from '../../server/stats/summary.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon, type IconName } from '../ui/icons.ts';
import { barList, columnChart, dataTable, heatLegend, heatmapSvg, ringSvg, segmentedBar, stackedColumnChart } from './charts.ts';
import { GOAL_MAX, GOAL_MIN } from './goal.ts';
import { goalView, heatLayout, libraryParts } from './insights.ts';
import {
  backlogView,
  formatCount,
  formatDateBr,
  formatHours,
  genreRows,
  kpiCards,
  monthRows,
  plural,
  ratingRows,
  WEEKDAY_SHORT,
  weekdayRows,
} from './model.ts';

/** Cores das séries: azul = conclusão, laranja = revisão (par validado para CVD no fundo da tela escura). */
export const SERIES_FINISHED = '#3987e5';
export const SERIES_REWATCH = '#d95926';
const SINGLE = '#3987e5';

const KPI_ICON: Record<string, IconName> = {
  finished: 'check',
  hours: 'clock',
  days: 'flame',
  rating: 'star',
  genre: 'tag',
  weekday: 'calendar',
};

const legend = (): string => `
  <ul class="stat-legend" aria-label="Legenda">
    <li><span class="swatch" style="background:${SERIES_FINISHED}" aria-hidden="true"></span>Conclusões</li>
    <li><span class="swatch" style="background:${SERIES_REWATCH}" aria-hidden="true"></span>Revisões</li>
  </ul>`;

const figure = (title: string, body: string, table: string, opts: { extra?: string; className?: string } = {}): string => `
  <figure class="stat-figure${opts.className ? ` ${opts.className}` : ''}">
    <figcaption>${escapeHtml(title)}</figcaption>${opts.extra ?? ''}
    <div class="stat-chart">${body}</div>
    ${table}
  </figure>`;

/** `data-count` marca os números inteiros: a tela anima a contagem (ver `animateCounts` em stats-page.ts). */
export const renderKpis = (s: StatsSummary): string =>
  kpiCards(s)
    .map(
      (k) => `
    <article class="stat-card stat-kpi" id="kpi-${k.id}">
      <p class="stat-label"><span class="stat-ico" aria-hidden="true">${icon(KPI_ICON[k.id] ?? 'chart', 'sm')}</span>${escapeHtml(k.label)}</p>
      <p class="stat-value"${k.count === undefined ? '' : ` data-count="${k.count}"`}>${escapeHtml(k.value)}</p>
      <p class="stat-hint">${escapeHtml(k.hint)}</p>
    </article>`,
    )
    .join('');

/** Cartão da meta do ano. Sem meta, mostra o campo para definir; com meta, o anel e o ritmo. */
export const renderGoal = (s: StatsSummary, goal: number | null, today: string): string => {
  const field = `
    <label class="goal-field">Meta de conclusões em ${s.year}
      <input id="stats-goal" type="number" inputmode="numeric" min="${GOAL_MIN}" max="${GOAL_MAX}" step="1" value="${goal ?? ''}" placeholder="ex.: 24">
    </label>`;
  if (goal === null) {
    return `
      <article class="stat-card stat-goal" id="stats-goal-card">
        <h2 class="stat-label"><span class="stat-ico" aria-hidden="true">${icon('target', 'sm')}</span>Meta do ano</h2>
        <p class="stat-hint">Defina quantos títulos quer concluir no ano e acompanhe o ritmo. Fica só neste navegador.</p>
        ${field}
      </article>`;
  }
  const view = goalView(s.period.finished, goal, s.year, today);
  const percent = Math.min(999, Math.round(view.progress * 100));
  return `
    <article class="stat-card stat-goal" id="stats-goal-card">
      <h2 class="stat-label"><span class="stat-ico" aria-hidden="true">${icon('target', 'sm')}</span>Meta do ano</h2>
      <div class="goal-body">
        <div class="ring" role="img" aria-label="${percent}% da meta: ${escapeHtml(view.headline)} títulos">
          ${ringSvg(view.progress)}
          <div class="ring-center"><strong>${percent}%</strong><span>da meta</span></div>
        </div>
        <div class="goal-text">
          <p class="stat-value stat-value-sm">${escapeHtml(view.headline)} <span class="stat-unit">${plural(goal, 'título', 'títulos')}</span></p>
          <p class="stat-hint">${escapeHtml(view.detail)}</p>
          ${field}
        </div>
      </div>
    </article>`;
};

export const renderLibraryAndBacklog = (s: StatsSummary): string => {
  const lib = s.library;
  const wt = lib.watchTime;
  const b = backlogView(s);
  const parts = libraryParts(s);
  const missing =
    wt.missingTitles > 0 || wt.episodesWithoutRuntime > 0
      ? `${formatCount(wt.missingTitles)} ${plural(wt.missingTitles, 'título', 'títulos')} sem duração e ${formatCount(wt.episodesWithoutRuntime)} ${plural(wt.episodesWithoutRuntime, 'episódio', 'episódios')} sem duração ficaram de fora.`
      : 'Duração completa para todos os assistidos.';
  return `
      <article class="stat-card stat-library">
        <h2 id="lib-title" class="stat-label"><span class="stat-ico" aria-hidden="true">${icon('library', 'sm')}</span>Biblioteca</h2>
        <p class="stat-value">${formatCount(lib.total)} <span class="stat-unit">${plural(lib.total, 'título', 'títulos')}</span></p>
        ${segmentedBar(parts, { label: 'Composição da biblioteca por status' })}
        <p class="stat-hint">${formatCount(lib.byStatus.watched)} ${plural(lib.byStatus.watched, 'assistido', 'assistidos')}, tempo estimado de ${formatHours(wt.hours)}. ${escapeHtml(missing)}</p>
        ${dataTable(
          'Biblioteca por status',
          ['Status', 'Títulos'],
          parts.map((p) => [p.label, String(p.value)]),
        )}
      </article>
      <article class="stat-card">
        <h2 class="stat-label"><span class="stat-ico" aria-hidden="true">${icon('bookmark', 'sm')}</span>Fila (quero ver)</h2>
        <p class="stat-value stat-value-sm">${escapeHtml(b.headline)}</p>
        <p class="stat-hint">${escapeHtml(b.detail)}</p>
      </article>`;
};

export const renderActivity = (s: StatsSummary): string => {
  const p = s.period;
  const streak = p.longestStreak;
  const summary = streak
    ? `${formatCount(p.activeDays)} ${plural(p.activeDays, 'dia ativo', 'dias ativos')}. Maior sequência: ${formatCount(streak.days)} ${plural(streak.days, 'dia', 'dias')}, de ${formatDateBr(streak.start)} a ${formatDateBr(streak.end)}.`
    : 'Nenhum dia com atividade neste ano.';
  return figure(
    `Atividade em ${s.year}`,
    `<div class="heat-wrap">
      <div class="heat-scroll" tabindex="0" role="region" aria-label="Mapa de atividade, rola na horizontal">${heatmapSvg(heatLayout(s.year, p.days), { label: `Eventos por dia em ${s.year}`, weekdays: WEEKDAY_SHORT })}</div>
      <div class="heat-aside"><p class="stat-hint">${escapeHtml(summary)}</p>${heatLegend()}</div>
    </div>`,
    dataTable(
      `Dias com atividade em ${s.year}`,
      ['Dia', 'Eventos'],
      p.days.map((d) => [formatDateBr(d.date), String(d.events)]),
    ),
    { className: 'stat-wide' },
  );
};

export const renderCharts = (s: StatsSummary): string => {
  const months = monthRows(s);
  const weekdays = weekdayRows(s);
  const ratings = ratingRows(s);
  const genres = genreRows(s);
  const monthChart = figure(
    'Por mês',
    stackedColumnChart(
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
    { extra: legend(), className: 'stat-main' },
  );
  const weekdayChart = figure(
    'Dia da semana',
    columnChart(weekdays, { label: 'Eventos por dia da semana', color: SINGLE }),
    dataTable(
      'Eventos por dia da semana',
      ['Dia', 'Eventos'],
      weekdays.map((w) => [w.label, String(w.value)]),
    ),
  );
  const ratingChart = figure(
    'Distribuição de notas',
    columnChart(ratings, { label: 'Notas dos títulos concluídos', color: SINGLE }),
    dataTable(
      'Notas dos títulos concluídos',
      ['Nota', 'Títulos'],
      ratings.map((r) => [r.label, String(r.value)]),
    ),
  );
  const genreChart = genres.length
    ? figure(
        'Gêneros mais vistos',
        barList(genres, { label: 'Gêneros mais vistos no ano', color: SINGLE }),
        dataTable(
          'Gêneros mais vistos no ano',
          ['Gênero', 'Títulos'],
          genres.map((g) => [g.label, String(g.value)]),
        ),
      )
    : `<figure class="stat-figure"><figcaption>Gêneros mais vistos</figcaption><p class="stat-hint">Nenhum gênero no catálogo ainda. Abrir o detalhe de um título preenche os gêneros.</p></figure>`;
  return `<div class="stat-charts">${renderActivity(s)}${monthChart}${weekdayChart}${ratingChart}${genreChart}</div>`;
};

export const renderNotes = (s: StatsSummary): string => `
  <details class="stat-notes">
    <summary>Como calculamos</summary>
    <ul>
      <li>"Concluído" e "revisão" vêm do histórico da lista. Cada um conta uma exibição do título.</li>
      <li>Tempo assistido = duração do título por exibição (filme: duração; série: soma dos episódios com duração no catálogo). Sem duração, a exibição fica de fora e é contada, não tratada como zero.</li>
      <li>Marcar episódio é atividade, não tempo: aparece nos dias ativos, no mapa e no mês, mas não soma horas.</li>
      <li>No mapa de atividade, a cor de cada dia é relativa ao dia mais movimentado do ano.</li>
      <li>A meta do ano conta os títulos concluídos e fica só neste navegador.</li>
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

export interface BodyOptions {
  goal: number | null;
  /** Dia civil do navegador (`AAAA-MM-DD`), para o ritmo da meta. */
  today: string;
}

export const renderBody = (s: StatsSummary, opts: BodyOptions): string => {
  if (!s.hasData) return renderNoData();
  const empty = s.period.activeDays === 0 ? renderEmptyYear(s.year) : '';
  return `
    ${empty}
    <div class="stat-kpis">${renderKpis(s)}</div>
    <section class="stats-wide" aria-label="Meta, biblioteca e fila">
      ${renderGoal(s, opts.goal, opts.today)}
      ${renderLibraryAndBacklog(s)}
    </section>
    ${renderCharts(s)}
    ${renderNotes(s)}`;
};
