import { describe, expect, test } from 'bun:test';
import { notifySummary } from '../../src/client/app/settings-model.ts';

describe('notifySummary', () => {
  test('desligado explica como ligar', () => {
    expect(notifySummary(false, 0)).toContain('.env');
  });
  test('ligado diz a antecedência, com singular e plural', () => {
    expect(notifySummary(true, 0)).toContain('no dia');
    expect(notifySummary(true, 1)).toContain('1 dia antes');
    expect(notifySummary(true, 3)).toContain('3 dias antes');
  });
});
