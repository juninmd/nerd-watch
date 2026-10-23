import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SPEED,
  DOUBLE_TAP_MS,
  isValidSpeed,
  MAX_SPEED,
  MIN_SPEED,
  nextSpeed,
  parseSpeed,
  percentTarget,
  progressFraction,
  registerTap,
  seekTarget,
  volumeTarget,
} from '../src/client/player-seek.ts';

describe('seekTarget', () => {
  test('soma o salto e fica dentro do vídeo', () => {
    expect(seekTarget(30, 10, 600)).toBe(40);
    expect(seekTarget(30, -10, 600)).toBe(20);
  });

  test('não passa do início nem do fim (pular além das pontas)', () => {
    expect(seekTarget(3, -10, 600)).toBe(0);
    expect(seekTarget(595, 10, 600)).toBe(600);
  });

  test('duração NaN ou Infinity (ao vivo) ou zero: não há como pular', () => {
    expect(seekTarget(10, 10, Number.NaN)).toBeNull();
    expect(seekTarget(10, 10, Number.POSITIVE_INFINITY)).toBeNull();
    expect(seekTarget(10, 10, 0)).toBeNull();
  });

  test('posição atual inválida não gera um tempo inválido', () => {
    expect(seekTarget(Number.NaN, 10, 600)).toBeNull();
  });
});

describe('percentTarget (teclas 0-9)', () => {
  test('0 é o início e 5 é a metade', () => {
    expect(percentTarget(0, 200)).toBe(0);
    expect(percentTarget(5, 200)).toBe(100);
    expect(percentTarget(9, 200)).toBe(180);
  });

  test('sem duração finita não há posição de destino', () => {
    expect(percentTarget(5, Number.NaN)).toBeNull();
    expect(percentTarget(5, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('volumeTarget', () => {
  test('passo de 5% com arredondamento (sem 0.30000000000000004)', () => {
    expect(volumeTarget(0.25, 0.05)).toBe(0.3);
    expect(volumeTarget(0.3, -0.05)).toBe(0.25);
  });

  test('limita entre 0 e 1', () => {
    expect(volumeTarget(0.98, 0.05)).toBe(1);
    expect(volumeTarget(0.02, -0.05)).toBe(0);
  });

  test('volume atual inválido não produz valor', () => {
    expect(volumeTarget(Number.NaN, 0.05)).toBeNull();
  });
});

describe('velocidade', () => {
  test('passos de 0,5x a 2x', () => {
    expect(MIN_SPEED).toBe(0.5);
    expect(MAX_SPEED).toBe(2);
    expect(DEFAULT_SPEED).toBe(1);
    expect(isValidSpeed(0.5)).toBe(true);
    expect(isValidSpeed(2)).toBe(true);
    expect(isValidSpeed(0.25)).toBe(false);
    expect(isValidSpeed(2.5)).toBe(false);
    expect(isValidSpeed(Number.NaN)).toBe(false);
  });

  test('nextSpeed anda um passo por vez e para nas pontas', () => {
    expect(nextSpeed(1, 1)).toBe(1.25);
    expect(nextSpeed(1, -1)).toBe(0.75);
    expect(nextSpeed(2, 1)).toBe(2);
    expect(nextSpeed(0.5, -1)).toBe(0.5);
  });

  test('nextSpeed parte do passo mais próximo quando a taxa não está na lista', () => {
    expect(nextSpeed(1.1, -1)).toBe(1);
    expect(nextSpeed(1.1, 1)).toBe(1.25);
  });

  test('taxa atual NaN é tratada como 1x', () => {
    expect(nextSpeed(Number.NaN, 1)).toBe(1.25);
  });

  test('parseSpeed aceita só valores válidos e cai para 1x no resto (localStorage corrompido)', () => {
    expect(parseSpeed('1.5')).toBe(1.5);
    expect(parseSpeed(null)).toBe(1);
    expect(parseSpeed('')).toBe(1);
    expect(parseSpeed('abc')).toBe(1);
    expect(parseSpeed('9')).toBe(1);
    expect(parseSpeed('-1')).toBe(1);
  });
});

describe('registerTap (duplo toque no touch)', () => {
  test('primeiro toque só registra; segundo do mesmo lado dentro de 300 ms pula', () => {
    const first = registerTap(null, 1000, 100, 400);
    expect(first).toEqual({ seek: null, memory: { at: 1000, side: 'back' } });
    const second = registerTap(first.memory, 1000 + DOUBLE_TAP_MS, 120, 400);
    expect(second).toEqual({ seek: 'back', memory: null });
  });

  test('lado direito vira avanço', () => {
    const first = registerTap(null, 0, 350, 400);
    expect(registerTap(first.memory, 100, 300, 400).seek).toBe('forward');
  });

  test('toques em lados diferentes não contam como duplo', () => {
    const first = registerTap(null, 0, 50, 400);
    const second = registerTap(first.memory, 100, 350, 400);
    expect(second.seek).toBeNull();
    expect(second.memory).toEqual({ at: 100, side: 'forward' });
  });

  test('depois da janela de 300 ms o segundo toque recomeça a contagem', () => {
    const first = registerTap(null, 0, 50, 400);
    const late = registerTap(first.memory, DOUBLE_TAP_MS + 1, 50, 400);
    expect(late.seek).toBeNull();
  });

  test('largura zero ou coordenada inválida são ignoradas (sem divisão quebrada)', () => {
    expect(registerTap(null, 0, 10, 0)).toEqual({ seek: null, memory: null });
    expect(registerTap(null, 0, Number.NaN, 400)).toEqual({ seek: null, memory: null });
  });
});

describe('progressFraction (barra de progresso e de buffer)', () => {
  test('dá a fração da duração', () => {
    expect(progressFraction(30, 120)).toBe(0.25);
  });

  test('limita a 0–1 mesmo com posição fora do vídeo', () => {
    expect(progressFraction(-5, 100)).toBe(0);
    expect(progressFraction(150, 100)).toBe(1);
  });

  test('sem duração finita (metadados ausentes ou ao vivo) a barra fica vazia', () => {
    expect(progressFraction(10, Number.NaN)).toBe(0);
    expect(progressFraction(10, Number.POSITIVE_INFINITY)).toBe(0);
    expect(progressFraction(10, 0)).toBe(0);
  });

  test('posição inválida não vira NaN na barra', () => {
    expect(progressFraction(Number.NaN, 100)).toBe(0);
  });
});
