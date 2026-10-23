import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// WCAG 2.x: texto normal precisa de 4.5:1 (AA).
const AA_NORMAL = 4.5;

const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};

const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const tokens = readFileSync(join(import.meta.dir, '../src/client/styles/tokens.css'), 'utf8');
const token = (name: string): string => {
  const m = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m?.[1]) throw new Error(`token --${name} não encontrado em tokens.css`);
  return m[1];
};
const gradientStops = (): string[] => {
  const m = tokens.match(/--gradient:\s*linear-gradient\([^)]*\);/);
  if (!m) throw new Error('--gradient não encontrado');
  return m[0].match(/#[0-9a-fA-F]{6}/g) ?? [];
};

const surfaces = ['bg', 'surface', 'surface-2', 'surface-hover'].map(token);

describe('contraste dos tokens de texto', () => {
  test('helper bate com a referência WCAG (preto sobre branco = 21:1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  for (const name of ['text', 'text-dim', 'text-faint']) {
    test(`--${name} tem 4.5:1 em todas as superfícies (metadados e placeholders não somem)`, () => {
      for (const bg of surfaces) expect(contrastRatio(token(name), bg)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }
});

describe('contraste dos rótulos de dia da agenda (12px, caixa-alta, em negrito)', () => {
  test('o violeta do cabeçalho de dia tem 4.5:1 em todas as superfícies', () => {
    const views = readFileSync(join(import.meta.dir, '../src/client/styles/views.css'), 'utf8');
    const m = views.match(/\.calendar-day-label\s*\{[^}]*?color:\s*(#[0-9a-fA-F]{6})\s*;/);
    if (!m?.[1]) throw new Error('.calendar-day-label sem cor hexadecimal em views.css');
    for (const bg of surfaces) expect(contrastRatio(m[1], bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('contraste do texto branco sobre o gradiente primário', () => {
  test('botões e chips ativos: branco em cada parada do gradiente tem 4.5:1', () => {
    const stops = gradientStops();
    expect(stops.length).toBeGreaterThanOrEqual(2);
    for (const stop of stops) expect(contrastRatio('#ffffff', stop)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
