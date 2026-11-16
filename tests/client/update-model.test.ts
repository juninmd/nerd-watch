import { expect, test } from 'bun:test';
import { formatMegabytes, progressLabel, progressPercent } from '../../src/client/platform/update-model.ts';

test('percentual limitado a 0–100 e nulo sem total', () => {
  expect(progressPercent(50, 200)).toBe(25);
  expect(progressPercent(300, 200)).toBe(100);
  expect(progressPercent(10, null)).toBeNull();
  expect(progressPercent(10, 0)).toBeNull();
});

test('rótulo com e sem total', () => {
  expect(formatMegabytes(1024 * 1024 * 1.5)).toBe('1,5 MB');
  expect(progressLabel(1024 * 1024, 4 * 1024 * 1024)).toBe('25% · 1,0 MB de 4,0 MB');
  expect(progressLabel(1024 * 1024, null)).toBe('1,0 MB baixados');
});
