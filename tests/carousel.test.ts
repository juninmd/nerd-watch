import { describe, expect, test } from 'bun:test';
import { edges, pageStep, scrollTarget, siblingIndex } from '../src/client/carousel.ts';

const metrics = (scrollLeft: number, clientWidth = 1000, scrollWidth = 5000) => ({ scrollLeft, clientWidth, scrollWidth });

describe('pageStep', () => {
  test('anda quase uma tela, deixando o próximo cartão à vista como pista', () => {
    expect(pageStep(1000)).toBe(900);
    expect(pageStep(333)).toBe(300);
  });

  test('nunca é zero, mesmo com a área sem largura', () => {
    expect(pageStep(0)).toBe(1);
  });
});

describe('scrollTarget', () => {
  test('avança e volta uma página', () => {
    expect(scrollTarget(metrics(0), 1)).toBe(900);
    expect(scrollTarget(metrics(1800), -1)).toBe(900);
  });

  test('não passa dos extremos', () => {
    expect(scrollTarget(metrics(100), -1)).toBe(0);
    expect(scrollTarget(metrics(3800), 1)).toBe(4000);
  });

  test('conteúdo que cabe na tela não rola', () => {
    expect(scrollTarget(metrics(0, 1000, 600), 1)).toBe(0);
  });
});

describe('edges', () => {
  test('no início e no fim, com tolerância de subpixel', () => {
    expect(edges(metrics(0))).toEqual({ atStart: true, atEnd: false });
    expect(edges(metrics(0.4))).toEqual({ atStart: true, atEnd: false });
    expect(edges(metrics(4000))).toEqual({ atStart: false, atEnd: true });
    expect(edges(metrics(3999.4))).toEqual({ atStart: false, atEnd: true });
    expect(edges(metrics(2000))).toEqual({ atStart: false, atEnd: false });
  });

  test('conteúdo que cabe na tela está nos dois extremos (sem setas)', () => {
    expect(edges(metrics(0, 1000, 800))).toEqual({ atStart: true, atEnd: true });
  });
});

describe('siblingIndex (setas do teclado entre cartões)', () => {
  test('vai ao vizinho e para nas pontas, sem dar a volta', () => {
    expect(siblingIndex(2, 5, 1)).toBe(3);
    expect(siblingIndex(2, 5, -1)).toBe(1);
    expect(siblingIndex(0, 5, -1)).toBe(0);
    expect(siblingIndex(4, 5, 1)).toBe(4);
  });

  test('foco fora dos cartões (índice -1) ou lista vazia não inventa posição', () => {
    expect(siblingIndex(-1, 5, 1)).toBe(-1);
    expect(siblingIndex(0, 0, 1)).toBe(-1);
  });
});
