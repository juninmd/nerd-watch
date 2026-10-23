import { getStats, type StatsDto } from '../api.ts';
import { countUp } from '../effects.ts';
import { escapeHtml, renderCard } from '../components/card.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { addDays, localIsoDate } from '../time-format.ts';
import { titlePath } from '../title-link.ts';

const STATUS_ROWS = [
  { key: 'watched', label: 'Assistidos', color: 'var(--success)' },
  { key: 'watching', label: 'Assistindo', color: 'var(--info)' },
  { key: 'want', label: 'Quero ver', color: 'var(--accent-2)' },
  { key: 'dropped', label: 'Abandonados', color: 'var(--danger)' },
] as const;

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const tile = (value: number | string, label: string, iconName: 'library' | 'flame' | 'check' | 'play'): string => `
  <div class="stat-tile">
    <span class="stat-ico" aria-hidden="true">${icon(iconName)}</span>
    <div class="stat-num"${typeof value === 'number' ? ` data-count="${value}"` : ''}>${value}</div>
    <div class="stat-label">${label}</div>
  </div>`;

const donut = (s: StatsDto): string => {
  let offset = 0;
  const arcs = STATUS_ROWS.map(({ key, color }) => {
    const share = s.total > 0 ? (s.byStatus[key] / s.total) * 100 : 0;
    const arc = `<circle class="donut-arc" cx="21" cy="21" r="15.915" pathLength="100" stroke="${color}" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${-offset}"/>`;
    offset += share;
    return arc;
  }).join('');
  const legend = STATUS_ROWS.map(
    ({ key, label, color }) => `<li><span class="dot" style="background:${color}"></span>${label}<b>${s.byStatus[key]}</b></li>`,
  ).join('');
  return `
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Distribuição por status: ${STATUS_ROWS.map((r) => `${s.byStatus[r.key]} ${r.label.toLowerCase()}`).join(', ')}">
        <circle class="donut-track" cx="21" cy="21" r="15.915"/>${arcs}
      </svg>
      <ul class="legend">${legend}</ul>
    </div>`;
};

const bars = (items: Array<{ label: string; value: number }>, caption: (i: { label: string; value: number }) => string): string => {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="bars" role="list">${items
    .map(
      (i, n) => `
      <div class="bar" role="listitem" aria-label="${caption(i)}" style="--h:${(i.value / max) * 100}%;--i:${n}">
        <span class="bar-val">${i.value || ''}</span><span class="bar-fill"></span><span class="bar-label">${i.label}</span>
      </div>`,
    )
    .join('')}</div>`;
};

/** 53 colunas de semanas (domingo a sábado) terminando hoje; o nível 0-4 vem da contagem relativa ao dia mais cheio. */
const heatmap = (s: StatsDto): string => {
  const counts = new Map(s.activity.map((a) => [a.date, a.count]));
  const max = Math.max(1, ...counts.values());
  const today = new Date();
  const start = addDays(today, -(52 * 7 + today.getDay()));
  const cells: string[] = [];
  for (let i = 0; i <= 52 * 7 + today.getDay(); i++) {
    const iso = localIsoDate(addDays(start, i));
    const n = counts.get(iso) ?? 0;
    const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
    cells.push(
      `<i class="hm lv${level}" style="--d:${Math.floor(i / 7) * 14}ms" title="${iso}: ${n} ${n === 1 ? 'evento' : 'eventos'}" aria-hidden="true"></i>`,
    );
  }
  const total = s.activity.reduce((sum, a) => sum + a.count, 0);
  return `<div class="heatmap-scroll"><div class="heatmap" role="img" aria-label="Atividade dos últimos 12 meses: ${total} eventos em ${s.activity.length} dias">${cells.join('')}</div></div>
    <div class="hm-legend" aria-hidden="true">menos <i class="hm lv0"></i><i class="hm lv1"></i><i class="hm lv2"></i><i class="hm lv3"></i><i class="hm lv4"></i> mais</div>`;
};

const section = (title: string, body: string, cls = ''): string =>
  `<section class="panel stat-panel ${cls}"><h2 class="panel-title">${title}</h2>${body}</section>`;

export const renderStats = (host: HTMLElement): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Estatísticas</h1>
      <p class="view-subtitle">Um retrato da sua biblioteca: o que você viu, como avaliou e quando assistiu.</p>
    </header>
    <div class="skeleton" style="height:120px;margin-bottom:16px"></div><div class="skeleton" style="height:260px"></div>`;

  getStats()
    .then((s) => {
      if (s.total === 0) {
        host.innerHTML = `
          <header class="view-head"><h1 class="view-title">Estatísticas</h1></header>
          <div class="empty-state"><div class="big">${icon('chart')}</div>Sua biblioteca está vazia. <a href="#/">Descubra algo para assistir</a> e volte aqui.</div>`;
        return;
      }
      const months = s.finishedByMonth.map((m) => ({
        label: MONTHS[Number(m.month.slice(5, 7)) - 1] ?? m.month,
        value: m.count,
      }));
      const rated = s.ratings.map((value, n) => ({ label: String(n), value }));
      host.innerHTML = `
        <header class="view-head">
          <h1 class="view-title">Estatísticas</h1>
          <p class="view-subtitle">Um retrato da sua biblioteca: o que você viu, como avaliou e quando assistiu.</p>
        </header>
        <div class="stat-tiles">
          ${tile(s.total, 'títulos na biblioteca', 'library')}
          ${tile(s.byStatus.watched, 'assistidos', 'check')}
          ${tile(s.streak.current, s.streak.current === 1 ? 'dia seguido' : 'dias seguidos', 'flame')}
          ${tile(s.averageRating === null ? '—' : s.averageRating.toLocaleString('pt-BR'), 'nota média', 'play')}
        </div>
        <div class="stat-grid">
          ${section('Por status', `${donut(s)}<p class="stat-note">${s.byType.movie} filmes · ${s.byType.tv} séries</p>`)}
          ${section('Notas que você deu', bars(rated, (i) => `nota ${i.label}: ${i.value}`), 'rating-panel')}
          ${section('Concluídos por mês', bars(months, (i) => `${i.label}: ${i.value}`))}
          ${section('Atividade no último ano', `${heatmap(s)}<p class="stat-note">Maior sequência: ${s.streak.longest} ${s.streak.longest === 1 ? 'dia' : 'dias'}</p>`, 'wide')}
        </div>
        ${s.topRated.length ? `<div class="section"><div class="section-head"><h2>${icon('check', 'sm')} Mais bem avaliados</h2></div><div class="rail" id="top-rated"></div></div>` : ''}
      `;
      for (const el of host.querySelectorAll<HTMLElement>('[data-count]')) countUp(el, Number(el.dataset.count));
      const rail = host.querySelector('#top-rated');
      for (const t of s.topRated) {
        rail?.appendChild(
          renderCard({
            title: t.title,
            posterUrl: t.posterUrl,
            meta: `★ ${t.rating}/10`,
            onClick: () => navigate(titlePath(t.source, t.mediaType, t.sourceId)),
          }),
        );
      }
    })
    .catch((e: Error) => {
      host.innerHTML = `<header class="view-head"><h1 class="view-title">Estatísticas</h1></header><div class="banner warn">${icon('alert')}<span>Não foi possível carregar: ${escapeHtml(e.message)}</span></div>`;
    });
};
