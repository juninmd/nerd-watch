import { describe, expect, test } from 'bun:test';
import { PATH_LABEL, decideSeek, inRanges, shiftedTime, withStart } from '../src/client/media-seek.ts';

/**
 * Posição no stream transcodificado. O navegador vê o tempo 0 no início do `?start=S`, e o usuário vê S. Um erro de
 * soma aqui faz a barra de progresso e a retomada caírem no lugar errado, então cada caso de borda é pinado.
 */
describe('posição com offset', () => {
  test('soma o offset ao tempo nativo', () => {
    expect(shiftedTime(120, 3.5)).toBe(123.5);
    expect(shiftedTime(0, 7)).toBe(7);
  });

  test('tempo nativo não finito (stream sem fim ainda) vale 0 em vez de NaN', () => {
    expect(shiftedTime(10, Number.POSITIVE_INFINITY)).toBe(10);
    expect(shiftedTime(10, Number.NaN)).toBe(10);
  });

  test('inRanges: borda inclusiva e lacunas', () => {
    const ranges = [
      { start: 0, end: 5 },
      { start: 10, end: 12 },
    ];
    expect(inRanges(ranges, 0)).toBe(true);
    expect(inRanges(ranges, 5)).toBe(true);
    expect(inRanges(ranges, 7)).toBe(false);
    expect(inRanges([], 0)).toBe(false);
  });
});

describe('decideSeek: mover o ponteiro ou reabrir o stream', () => {
  const buffered = [{ start: 0, end: 30 }];

  test('alvo já baixado: só move o ponteiro nativo, deslocado pelo offset', () => {
    expect(decideSeek(60, 75, buffered)).toEqual({ kind: 'native', at: 15 });
  });

  test('alvo fora do baixado: reabre o stream naquele ponto', () => {
    expect(decideSeek(60, 200, buffered)).toEqual({ kind: 'reload', start: 200 });
  });

  test('alvo antes do offset atual não existe no stream: reabre', () => {
    expect(decideSeek(60, 30, buffered)).toEqual({ kind: 'reload', start: 30 });
  });

  test('alvo negativo ou NaN vira o início (nunca reabre em posição inválida)', () => {
    expect(decideSeek(0, -5, buffered)).toEqual({ kind: 'native', at: 0 });
    expect(decideSeek(0, Number.NaN, buffered)).toEqual({ kind: 'native', at: 0 });
  });

  test('sem nada baixado ainda, todo seek reabre', () => {
    expect(decideSeek(0, 1, [])).toEqual({ kind: 'reload', start: 1 });
  });
});

describe('withStart: URL do stream', () => {
  test('acrescenta start com 3 casas e preserva os outros parâmetros', () => {
    expect(withStart('/api/media/c/i/live?audio=1', 12.5, 'http://127.0.0.1:7799')).toBe('/api/media/c/i/live?audio=1&start=12.500');
  });

  test('substitui um start anterior em vez de duplicar', () => {
    const once = withStart('/api/media/c/i/live', 3, 'http://x');
    expect(withStart(once, 9, 'http://x')).toBe('/api/media/c/i/live?start=9.000');
  });

  test('posição negativa é zerada', () => {
    expect(withStart('/l', -4, 'http://x')).toBe('/l?start=0.000');
  });
});

describe('rótulos de caminho', () => {
  test('os rótulos são os que a UI mostra (português, sem ambiguidade)', () => {
    expect(PATH_LABEL.direct).toBe('direto');
    expect(PATH_LABEL.remux).toBe('remux');
    expect(PATH_LABEL.transcode).toBe('transcodificado');
    expect(PATH_LABEL.unavailable).toBe('indisponível');
    expect(PATH_LABEL['n/a']).toBe('');
  });
});
