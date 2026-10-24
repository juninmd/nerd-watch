/**
 * Gráficos em SVG puro (sem biblioteca). Funções puras: recebem dados, devolvem markup. Cada marca é focável
 * (tabindex) e carrega o texto do tooltip em `data-tip`, então o teclado e o leitor de tela alcançam o mesmo dado
 * que o mouse. A tabela equivalente é gerada à parte (`dataTable`), para quem não enxerga o gráfico.
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

/* Viewbox estreito de propósito: em 390 px o gráfico escala para ~0,9x e o texto continua legível sem rolagem. */
const W = 400;
const H = 220;
const PAD_L = 34;
const PAD_B = 28;
const PAD_T = 10;

/** Colunas verticais com eixo Y de três marcas (0, meio e máximo). `color` é a cor da série (token ou hex). */
export const columnChartSvg = (items: BarItem[], opts: { label: string; color: string }): string => {
  const max = niceMax(Math.max(0, ...items.map((i) => i.value)));
  const plotH = H - PAD_B - PAD_T;
  const slot = (W - PAD_L) / Math.max(items.length, 1);
  const barW = Math.max(6, Math.min(44, slot * 0.6));
  const grid = gridLines(max, plotH);
  const bars = items
    .map((item, i) => {
      const h = (item.value / max) * plotH;
      const x = PAD_L + i * slot + (slot - barW) / 2;
      const y = PAD_T + plotH - h;
      const rect =
        item.value > 0
          ? `<rect class="stat-bar" style="--i:${i}" x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${opts.color}" tabindex="0" role="img" aria-label="${esc(item.tip)}" data-tip="${esc(item.tip)}"/>`
          : '';
      return `${rect}<text class="stat-x" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(item.label)}</text>`;
    })
    .join('');
  return `<svg class="stat-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(opts.label)}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
};

/** Colunas empilhadas (ex.: conclusões + revisões por mês). Cada segmento leva um recorte da cor do fundo: separação de 2 px. */
export const stackedColumnChartSvg = (items: StackedItem[], opts: { label: string; colors: string[] }): string => {
  const totals = items.map((i) => i.segments.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotH = H - PAD_B - PAD_T;
  const slot = (W - PAD_L) / Math.max(items.length, 1);
  const barW = Math.max(6, Math.min(44, slot * 0.6));
  const grid = gridLines(max, plotH);
  const cols = items
    .map((item, i) => {
      const x = PAD_L + i * slot + (slot - barW) / 2;
      let base = PAD_T + plotH;
      const parts = item.segments
        .map((v, s) => {
          if (v <= 0) return '';
          const h = (v / max) * plotH;
          base -= h;
          return `<rect class="stat-bar" style="--i:${i}" x="${x}" y="${base}" width="${barW}" height="${h}" fill="${opts.colors[s] ?? opts.colors[0]}" tabindex="0" role="img" aria-label="${esc(item.tips[s] ?? '')}" data-tip="${esc(item.tips[s] ?? '')}"/>`;
        })
        .join('');
      return `${parts}<text class="stat-x" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(item.label)}</text>`;
    })
    .join('');
  return `<svg class="stat-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(opts.label)}" preserveAspectRatio="xMidYMid meet">${grid}${cols}</svg>`;
};

/** Barras horizontais (gêneros). Altura fixa por linha; o rótulo fica à esquerda, nunca dentro da barra. */
export const barListSvg = (items: BarItem[], opts: { label: string; color: string }): string => {
  const rowH = 30;
  const labelW = 132;
  const valueW = 30;
  const h = Math.max(rowH, items.length * rowH + 8);
  const max = niceMax(Math.max(0, ...items.map((i) => i.value)));
  const plotW = W - labelW - valueW;
  const rows = items
    .map((item, i) => {
      const y = 4 + i * rowH;
      const w = (item.value / max) * plotW;
      return [
        `<text class="stat-row-label" x="0" y="${y + 19}">${esc(truncate(item.label, 17))}</text>`,
        `<rect class="stat-bar" style="--i:${i}" x="${labelW}" y="${y + 6}" width="${Math.max(w, 2)}" height="18" rx="3" fill="${opts.color}" tabindex="0" role="img" aria-label="${esc(item.tip)}" data-tip="${esc(item.tip)}"/>`,
        `<text class="stat-row-value" x="${W}" y="${y + 19}" text-anchor="end">${item.value}</text>`,
      ].join('');
    })
    .join('');
  return `<svg class="stat-svg stat-svg-bars" viewBox="0 0 ${W} ${h}" role="group" aria-label="${esc(opts.label)}" preserveAspectRatio="xMinYMin meet">${rows}</svg>`;
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

/** Linhas de grade e rótulos do eixo Y: 0, metade e máximo. */
const gridLines = (max: number, plotH: number): string =>
  [max, max / 2, 0]
    .map((t) => {
      const y = PAD_T + plotH - (t / max) * plotH;
      return `<line class="stat-grid" x1="${PAD_L}" x2="${W}" y1="${y}" y2="${y}"/><text class="stat-tick" x="${PAD_L - 6}" y="${y + 4}" text-anchor="end">${formatTick(t)}</text>`;
    })
    .join('');

/** Rótulo curto para a barra; o nome completo fica no tooltip, no aria-label e na tabela. */
const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const formatTick = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 100) / 10} mil` : String(Math.round(n * 10) / 10);
