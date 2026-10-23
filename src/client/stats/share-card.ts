import { MONTH_SHORT } from './model.ts';
import type { ShareCardModel } from './share-model.ts';

/**
 * Desenha o cartão "Meu ano" em um canvas, 100% no navegador: nada sai do aparelho. Formato 4:5 (1080 × 1350),
 * cores de fundo e de série vindas dos mesmos tokens da tela (paleta validada em references/palette.md).
 */
export const CARD_W = 1080;
export const CARD_H = 1350;

const COLORS = {
  bg: '#0a0b12',
  panel: '#12141f',
  text: '#f1f2f8',
  dim: '#9aa0b8',
  finished: '#3987e5',
  rewatch: '#d95926',
  grid: '#262a3d',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const fit = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string => {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
};

/** Desenha o cartão no contexto dado (canvas já dimensionado em CARD_W × CARD_H). */
export const drawShareCard = (ctx: CanvasRenderingContext2D, m: ShareCardModel): void => {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 48, 48, CARD_W - 96, CARD_H - 96, 36);
  ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText('MEU ANO EM', 96, 150);
  ctx.fillStyle = COLORS.text;
  ctx.font = `800 150px ${FONT}`;
  ctx.fillText(String(m.year), 92, 300);

  ctx.font = `600 44px ${FONT}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fit(ctx, m.headline, CARD_W - 192, `600 44px ${FONT}`), 96, 370);

  // Mosaico de indicadores: 2 colunas, 3 linhas.
  m.tiles.forEach((tile, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 96 + col * 438;
    const y = 430 + row * 150;
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(fit(ctx, tile.label, 400, `500 30px ${FONT}`), x, y);
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 54px ${FONT}`;
    ctx.fillText(fit(ctx, tile.value, 400, `700 54px ${FONT}`), x, y + 66);
  });

  drawMonths(ctx, m.months);

  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(m.footer, 96, CARD_H - 110);
};

const drawMonths = (ctx: CanvasRenderingContext2D, months: number[]): void => {
  const left = 96;
  const right = CARD_W - 96;
  const top = 920;
  const bottom = 1180;
  const max = Math.max(1, ...months);
  const slot = (right - left) / 12;
  const barW = slot * 0.6;

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText('Conclusões e revisões por mês', left, top - 40);

  months.forEach((value, i) => {
    const h = (value / max) * (bottom - top);
    const x = left + i * slot + (slot - barW) / 2;
    if (value > 0) {
      ctx.fillStyle = COLORS.finished;
      roundRect(ctx, x, bottom - h, barW, h, 8);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 22px ${FONT}`;
    const label = MONTH_SHORT[i] ?? '';
    ctx.fillText(label, x, bottom + 36);
  });
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** PNG do cartão, gerado localmente com canvas.toBlob. Sem rede, sem upload. */
export const shareCardPng = (m: ShareCardModel): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas 2D indisponível neste navegador'));
  drawShareCard(ctx, m);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('não foi possível gerar o PNG'))), 'image/png');
  });
};
