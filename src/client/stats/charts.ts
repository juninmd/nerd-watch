/**
 * Gráficos das estatísticas, sem biblioteca. Funções puras: recebem dados, devolvem markup.
 *
 * Colunas e barras são HTML/CSS (não SVG com viewBox): o texto fica no tamanho real da fonte em qualquer largura,
 * em vez de esticar junto com o desenho, e as marcas caem em pixels inteiros. Só o mapa de atividade e o anel da
 * meta são SVG, desenhados no tamanho natural (sem escala).
 *
 * Cada marca é focável (tabindex) e carrega o texto do tooltip em `data-tip`, então teclado e leitor de tela
 * alcançam o mesmo dado que o mouse. A tabela equivalente sai de `dataTable`, para quem não enxerga o gráfico.
 */

export interface BarItem {
  label: string;
  value: number;
  tip: string;
}

export interface StackedItem {
  label: string;
  segments: number[];
  tips: string[];
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Maior valor "redondo" (1, 2 ou 5 × 10ⁿ) que cobre `value`; escala de eixo com marcas limpas. */
export const niceMax = (value: number): number => {
  if (value <= 1) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= value) return m * base;
  }
  return 10 * base;
};

/**
 * Marcas do eixo Y para contagens: sempre inteiras. Até 10 o teto é o menor par (ou 1) que cobre o valor, para o
 * meio do eixo não cair em "0,5 título"; acima disso vale `niceMax`, cujo meio já é inteiro.
 */
export const axisTicks = (value: number): number[] => {
  if (value <= 1) return [0, 1];
  if (value <= 10) {
    const max = value <= 2 ? 2 : Math.ceil(value / 2) * 2;
    return [0, max / 2, max];
  }
  const max = niceMax(value);
  return [0, max / 2, max];
};

const formatTick = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10} mil` : String(n));

const pct = (value: number, max: number): string => `${Math.round((value / max) * 10000) / 100}%`;

/** Linhas de grade e rótulos do eixo Y. Decorativo: os valores estão nas marcas e na tabela. */
const grid = (ticks: number[]): string => {
  const max = ticks[ticks.length - 1] as number;
  return `<div class="chart-grid" aria-hidden="true">${ticks.map((t) => `<span style="--at:${pct(t, max)}"><i>${formatTick(t)}</i></span>`).join('')}</div>`;
};

const xAxis = (labels: string[]): string =>
  `<div class="chart-x" aria-hidden="true">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;

interface Segment {
  value: number;
  tip: string;
  color: string;
}

/** Coluna com um ou mais segmentos empilhados. O de cima leva a ponta arredondada; zero não desenha nada. */
const column = (segments: Segment[], max: number, index: number, capLabel: string | null): string => {
  const drawn = segments.filter((s) => s.value > 0);
  const marks = drawn
    .map((s, i) => {
      const cap = i === drawn.length - 1 ? ' is-cap' : '';
      return `<div class="chart-bar${cap}" style="--h:${pct(s.value, max)};--i:${index};background:${s.color}" tabindex="0" role="img" aria-label="${esc(s.tip)}" data-tip="${esc(s.tip)}"></div>`;
    })
    .join('');
  const label = capLabel === null ? '' : `<span class="chart-val" aria-hidden="true">${esc(capLabel)}</span>`;
  // column-reverse: o primeiro segmento fica na base, e o rótulo (último) acima da ponta.
  return `<div class="chart-col">${marks}${label}</div>`;
};

/** Só a coluna mais alta leva o número na ponta (a primeira, em empate): rótulo em tudo vira ruído. */
const tallest = (totals: number[]): number => {
  const max = Math.max(0, ...totals);
  return max > 0 ? totals.indexOf(max) : -1;
};

const columns = (label: string, labels: string[], cols: Segment[][]): string => {
  const totals = cols.map((segments) => segments.reduce((n, s) => n + Math.max(0, s.value), 0));
  const ticks = axisTicks(Math.max(0, ...totals));
  const max = ticks[ticks.length - 1] as number;
  const top = tallest(totals);
  const body = cols.map((segments, i) => column(segments, max, i, i === top ? formatTick(totals[i] as number) : null)).join('');
  return `<div class="chart chart-cols" role="group" aria-label="${esc(label)}" style="--cols:${Math.max(cols.length, 1)}">
    <div class="chart-plot">${grid(ticks)}<div class="chart-bars">${body}</div></div>
    ${xAxis(labels)}
  </div>`;
};

/** Colunas verticais de uma série. `color` é a cor da série (hex da paleta validada). */
export const columnChart = (items: BarItem[], opts: { label: string; color: string }): string =>
  columns(
    opts.label,
    items.map((i) => i.label),
    items.map((i) => [{ value: i.value, tip: i.tip, color: opts.color }]),
  );

/** Colunas empilhadas (ex.: conclusões + revisões por mês), com 2 px de fundo entre os segmentos. */
export const stackedColumnChart = (items: StackedItem[], opts: { label: string; colors: string[] }): string =>
  columns(
    opts.label,
    items.map((i) => i.label),
    items.map((i) => i.segments.map((value, s) => ({ value, tip: i.tips[s] ?? '', color: opts.colors[s] ?? (opts.colors[0] as string) }))),
  );

/** Barras horizontais (gêneros). O rótulo fica à esquerda, nunca dentro da barra; nome longo corta com reticências no CSS. */
export const barList = (items: BarItem[], opts: { label: string; color: string }): string => {
  const max = Math.max(1, ...items.map((i) => i.value));
  const rows = items
    .map(
      (item, i) => `<div class="chart-row">
        <span class="chart-row-label" title="${esc(item.label)}">${esc(item.label)}</span>
        <div class="chart-track"><div class="chart-bar-h" style="--w:${pct(item.value, max)};--i:${i};background:${opts.color}" tabindex="0" role="img" aria-label="${esc(item.tip)}" data-tip="${esc(item.tip)}"></div></div>
        <span class="chart-row-value" aria-hidden="true">${item.value}</span>
      </div>`,
    )
    .join('');
  return `<div class="chart chart-rows" role="group" aria-label="${esc(opts.label)}">${rows}</div>`;
};

export interface BarPart {
  label: string;
  value: number;
  color: string;
  tip: string;
}

/** Texto dentro de um bloco só quando cabe com folga; abaixo disso o valor fica no tooltip e na tabela. */
const SHARE_LABEL_MIN = 0.12;

/** Um todo dividido em partes (composição da biblioteca). Parte zerada não desenha nada; a legenda segue a ordem dos blocos. */
export const segmentedBar = (parts: BarPart[], opts: { label: string }): string => {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  if (total === 0) return '';
  const drawn = parts.filter((p) => p.value > 0);
  const blocks = drawn
    .map((p, i) => {
      const share = p.value / total;
      const text = share >= SHARE_LABEL_MIN ? `${Math.round(share * 100)}%` : '';
      return `<div class="seg" style="--share:${p.value};--i:${i};background:${p.color}" tabindex="0" role="img" aria-label="${esc(p.tip)}" data-tip="${esc(p.tip)}">${text}</div>`;
    })
    .join('');
  const legend = drawn
    .map((p) => `<li><span class="swatch" style="background:${p.color}" aria-hidden="true"></span>${esc(p.label)}</li>`)
    .join('');
  return `<div class="seg-bar" role="group" aria-label="${esc(opts.label)}">${blocks}</div><ul class="stat-legend" aria-label="Legenda">${legend}</ul>`;
};

export interface HeatCell {
  date: string;
  /** Coluna = semana do ano (domingo abre a semana); linha = dia da semana (0 = domingo). */
  col: number;
  row: number;
  /** 0 = sem atividade; 1 a 4 = quartos do dia mais movimentado do ano. */
  level: number;
  tip: string;
}

export interface HeatMonth {
  label: string;
  col: number;
}

export interface HeatLayout {
  cells: HeatCell[];
  months: HeatMonth[];
  weeks: number;
}

const HEAT_CELL = 14;
const HEAT_STEP = 18;
const HEAT_LEFT = 30;
const HEAT_TOP = 18;
/** Rampa de um matiz só (azul), do mais perto do fundo ao mais claro: validada como escala ordinal no fundo escuro. */
export const HEAT_RAMP = ['#184f95', '#256abf', '#3987e5', '#86b6ef'];

/** Mapa de atividade do ano: um quadrado por dia. Nível 0 é só o trilho; os dias ativos são focáveis e têm tooltip. */
export const heatmapSvg = (layout: HeatLayout, opts: { label: string; weekdays: string[] }): string => {
  const width = HEAT_LEFT + layout.weeks * HEAT_STEP;
  const height = HEAT_TOP + 7 * HEAT_STEP;
  const cells = layout.cells
    .map((c) => {
      const x = HEAT_LEFT + c.col * HEAT_STEP;
      const y = HEAT_TOP + c.row * HEAT_STEP;
      if (c.level === 0) return `<rect class="heat-cell" x="${x}" y="${y}" width="${HEAT_CELL}" height="${HEAT_CELL}" rx="3.5"/>`;
      return `<rect class="heat-cell is-on" x="${x}" y="${y}" width="${HEAT_CELL}" height="${HEAT_CELL}" rx="3.5" style="--i:${c.col};fill:${HEAT_RAMP[c.level - 1]}" tabindex="0" role="img" aria-label="${esc(c.tip)}" data-tip="${esc(c.tip)}"/>`;
    })
    .join('');
  const months = layout.months
    .map((m) => `<text class="heat-label" x="${HEAT_LEFT + m.col * HEAT_STEP}" y="11">${esc(m.label)}</text>`)
    .join('');
  // Só segunda, quarta e sexta: sete rótulos seguidos ficariam colados e competiriam com os quadrados.
  const weekdays = [1, 3, 5]
    .map((row) => `<text class="heat-label" x="0" y="${HEAT_TOP + row * HEAT_STEP + 11}">${esc(opts.weekdays[row] ?? '')}</text>`)
    .join('');
  return `<svg class="heat-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="${esc(opts.label)}">${months}${weekdays}${cells}</svg>`;
};

/** Legenda do mapa: do menos ao mais, com os mesmos quadrados. */
export const heatLegend = (): string =>
  `<p class="heat-legend" aria-hidden="true">menos <span class="heat-key"></span>${HEAT_RAMP.map((c) => `<span class="heat-key" style="background:${c}"></span>`).join('')} mais</p>`;

const RING_R = 52;
const RING_LEN = 2 * Math.PI * RING_R;

/** Anel de progresso (0 a 1). O trilho é um passo escuro do mesmo azul; o número fica em HTML, por cima. */
export const ringSvg = (progress: number): string => {
  const p = Math.min(1, Math.max(0, progress));
  // Sem progresso não há arco: um traço de comprimento zero com ponta redonda viraria um ponto solto.
  const fill =
    p > 0
      ? `<circle class="ring-fill" cx="64" cy="64" r="${RING_R}" stroke-dasharray="${RING_LEN.toFixed(2)}" style="--gap:${(RING_LEN * (1 - p)).toFixed(2)};--len:${RING_LEN.toFixed(2)}" transform="rotate(-90 64 64)"/>`
      : '';
  return `<svg class="ring-svg" width="128" height="128" viewBox="0 0 128 128" aria-hidden="true"><circle class="ring-track" cx="64" cy="64" r="${RING_R}"/>${fill}</svg>`;
};

/** Tabela equivalente ao gráfico, dentro de um <details> fechado: a mesma informação, em texto. */
export const dataTable = (caption: string, headers: string[], rows: string[][]): string => `
  <details class="stat-data">
    <summary>Ver os números</summary>
    <table>
      <caption>${esc(caption)}</caption>
      <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </details>`;
